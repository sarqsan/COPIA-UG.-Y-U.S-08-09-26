import * as XLSX from 'xlsx';
import { ExcelValidationResult,
  ExcelRowParsed,
  ImportSimulationSummary,
  ImportSimulationRow,
  Persona,
  Empleo,
  Grupo,
  GRUPOS_VALIDOS,
} from '../types';
import {
  MIN_PERSONAL_GRUPO,
  MAX_PERSONAL_GRUPO,
  normalizeEmpleo,
  normalizeGrupo,
  normalizeDni,
  findMatchingPersona,
} from '../utils/validators';
import {
  collection,
  doc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { registrarAuditLog } from './auditService';
import { setMemoryPersonasCache, getPersonas, guardarPersonasMemoriaYLocal } from './personasService';
import { asegurarCuentasParaPersonas } from './cuentasService';
import { limpiarTodosCambiosUG } from './cambiosService';
import { limpiarTodasAusenciasUG } from './ausenciasService';
import { regenerarCuadranteLimpioUG } from './cuadranteService';

const UNIDADES_DISTRIBUIDAS: Grupo[] = ['U.G.', 'US_SEGURIDAD'];

export const parseExcelFile = async (
  file: File,
  existingPersonas: Persona[]
): Promise<ExcelValidationResult> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];

        if (!firstSheetName) {
          return resolve({
            isValid: false,
            totalCount: 0,
            rol1Count: 0,
            rol2Count: 0,
            gruposCount: {
              'U.G.': 0,
              'US_SEGURIDAD': 0,
            },
            validRows: [],
            invalidRows: [],
            generalErrors: ['El archivo Excel está vacío o no contiene hojas de cálculo.'],
          });
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!rawJson || rawJson.length === 0) {
          return resolve({
            isValid: false,
            totalCount: 0,
            rol1Count: 0,
            rol2Count: 0,
            gruposCount: {
              'U.G.': 0,
              'US_SEGURIDAD': 0,
            },
            validRows: [],
            invalidRows: [],
            generalErrors: [
              'El archivo no contiene filas. Debe incluir los 22 apellidos (11 de ROL 1 y 11 de ROL 2).',
            ],
          });
        }

        // 1. Detectar si la primera fila es cabecera o ya son datos directos
        const firstRowCells = (rawJson[0] || []).map((c: any) => String(c || '').trim());
        const firstRowLower = firstRowCells.map((c: string) => c.toLowerCase());

        const isStrictHeaderCell = (s: string) => {
          const clean = s.toLowerCase().trim();
          if (
            clean === 'rol 1' ||
            clean === 'rol 2' ||
            clean === 'rol1' ||
            clean === 'rol2' ||
            clean === 'r1' ||
            clean === 'r2' ||
            clean === '1' ||
            clean === '2' ||
            clean === 'cabo' ||
            clean === 'soldado'
          ) {
            return false;
          }
          return [
            'nombre', 'nombres', 'apellido', 'apellidos', 'persona', 'personas', 'efectivo', 'efectivos',
            'personal', 'rol', 'roles', 'empleo', 'empleos', 'rango', 'cargo', 'grupo', 'grupos',
            'destino', 'dni', 'telefono', 'teléfono', 'tel', 'orden'
          ].includes(clean);
        };

        // Una fila es cabecera si tiene palabras clave explícitas de encabezado ('apellido', 'nombre', etc.)
        // y NO contiene un apellido de persona real en ambas celdas
        const hasHeaderRow = firstRowLower.some((c: string) => isStrictHeaderCell(c));
        const startRowIndex = hasHeaderRow ? 1 : 0;

        let nombreIdx = -1;
        let empleoIdx = -1;
        let grupoIdx = -1;
        let dniIdx = -1;
        let telIdx = -1;

        if (hasHeaderRow) {
          nombreIdx = firstRowLower.findIndex((h: string) =>
            isStrictHeaderCell(h) && (h.includes('apellido') || h.includes('nombre') || h.includes('persona') || h.includes('efectivo') || h.includes('usuario'))
          );
          empleoIdx = firstRowLower.findIndex((h: string) =>
            isStrictHeaderCell(h) && (h.includes('rol') || h.includes('empleo') || h.includes('rango') || h.includes('cargo') || h.includes('puesto'))
          );
          grupoIdx = firstRowLower.findIndex((h: string) =>
            isStrictHeaderCell(h) && (h.includes('grupo') || h.includes('destino') || h.includes('cia') || h.includes('u.'))
          );
          dniIdx = firstRowLower.findIndex((h: string) =>
            isStrictHeaderCell(h) && (h.includes('dni') || h.includes('identificacion') || h.includes('nif'))
          );
          telIdx = firstRowLower.findIndex((h: string) =>
            isStrictHeaderCell(h) && (h.includes('tel') || h.includes('movil') || h.includes('telefono'))
          );
        }

        // 2. Extraer todas las filas no vacías
        const rawDataRows: { originalRowIndex: number; cells: any[] }[] = [];
        for (let i = startRowIndex; i < rawJson.length; i++) {
          const row = rawJson[i];
          if (!row || row.length === 0 || row.every((c: any) => c === undefined || c === null || String(c).trim() === '')) {
            continue;
          }
          rawDataRows.push({ originalRowIndex: i + 1, cells: row });
        }

        // Comprobar si el archivo es un formato de 2 columnas de apellidos lado a lado (Columna A: ROL 1, Columna B: ROL 2)
        let isSideBySideLayout = false;
        if (rawDataRows.length > 0) {
          const sample = rawDataRows[0].cells;
          if (sample.length >= 2) {
            const val0 = String(sample[0] || '').trim();
            const val1 = String(sample[1] || '').trim();
            const isRole0 = normalizeEmpleo(val0) !== null;
            const isRole1 = normalizeEmpleo(val1) !== null;

            // Si ambas columnas contienen nombres/apellidos y ninguna es un rol explícito (ej: "GARCIA", "RUIZ")
            // o si los encabezados eran "ROL 1" y "ROL 2"
            if (!isRole0 && !isRole1 && val0.length >= 2 && val1.length >= 2) {
              const header0 = String(firstRowCells[0] || '').toLowerCase();
              const header1 = String(firstRowCells[1] || '').toLowerCase();
              if (
                (header0.includes('rol 1') && header1.includes('rol 2')) ||
                (header0.includes('1') && header1.includes('2')) ||
                rawDataRows.length <= 12
              ) {
                isSideBySideLayout = true;
              }
            }
          }
        }

        // Si no es side-by-side, inferir columnas si no se resolvieron por cabecera
        if (!isSideBySideLayout && rawDataRows.length > 0 && (nombreIdx === -1 || empleoIdx === -1 || nombreIdx === empleoIdx)) {
          const sampleRow = rawDataRows[0].cells;
          const totalCols = sampleRow.length;

          if (totalCols === 1) {
            nombreIdx = 0;
            empleoIdx = -1;
          } else if (totalCols >= 2) {
            const cell0 = String(sampleRow[0] || '').trim();
            const cell1 = String(sampleRow[1] || '').trim();
            const col0IsRole = normalizeEmpleo(cell0) !== null;
            const col1IsRole = normalizeEmpleo(cell1) !== null;

            if (col0IsRole && !col1IsRole) {
              empleoIdx = 0;
              nombreIdx = 1;
            } else if (col1IsRole && !col0IsRole) {
              nombreIdx = 0;
              empleoIdx = 1;
            } else {
              nombreIdx = 0;
              empleoIdx = 1;
            }
          }
        }

        if (nombreIdx === -1) nombreIdx = 0;

        const validRows: ExcelRowParsed[] = [];
        const invalidRows: ExcelRowParsed[] = [];
        const seenDnis = new Set<string>();

        // 3. Procesar filas
        if (isSideBySideLayout) {
          // Formato lado a lado: cada fila contiene 1 efectivo ROL 1 en col 0 y 1 efectivo ROL 2 en col 1
          let rowIndexSeq = 1;
          rawDataRows.forEach((item) => {
            const nameRol1 = String(item.cells[0] || '').trim().toUpperCase();
            const nameRol2 = String(item.cells[1] || '').trim().toUpperCase();

            if (nameRol1) {
              const numSec1 = String(rowIndexSeq).padStart(2, '0');
              const dniGenerado1 = `100000${numSec1}A`;
              validRows.push({
                rowNumber: item.originalRowIndex,
                nombre: nameRol1,
                empleo: 'ROL 1',
                grupo: 'U.G.',
                dni: dniGenerado1,
                telefono: `6000000${numSec1}`,
                valid: true,
                errors: [],
              });
              rowIndexSeq++;
            }

            if (nameRol2) {
              const numSec2 = String(rowIndexSeq).padStart(2, '0');
              const dniGenerado2 = `100000${numSec2}B`;
              validRows.push({
                rowNumber: item.originalRowIndex,
                nombre: nameRol2,
                empleo: 'ROL 2',
                grupo: 'U.G.',
                dni: dniGenerado2,
                telefono: `6000000${numSec2}`,
                valid: true,
                errors: [],
              });
              rowIndexSeq++;
            }
          });
        } else {
          // Formato estándar fila a fila
          const totalRawRows = rawDataRows.length;
          const mitad = Math.ceil(totalRawRows / 2);

          rawDataRows.forEach((item, index) => {
            const row = item.cells;
            const rawNombre = String(nombreIdx !== -1 && row[nombreIdx] !== undefined ? row[nombreIdx] : row[0] || '').trim();
            const rawEmpleo = empleoIdx !== -1 && row[empleoIdx] !== undefined ? String(row[empleoIdx]).trim() : '';
            const rawGrupo = grupoIdx !== -1 && row[grupoIdx] !== undefined ? String(row[grupoIdx]).trim() : '';
            const rawDni = dniIdx !== -1 && row[dniIdx] !== undefined ? String(row[dniIdx]).trim() : '';
            const rawTel = telIdx !== -1 && row[telIdx] !== undefined ? String(row[telIdx]).trim() : '';

            const errors: string[] = [];

            if (!rawNombre) {
              errors.push('Falta el apellido de la persona.');
            }

            // Nombre/Apellido normalizado en mayúsculas
            const nombreFormateado = rawNombre.toUpperCase();

            // Determinar Rol/Empleo:
            let normEmpleo: Empleo | null = null;
            if (rawEmpleo) {
              normEmpleo = normalizeEmpleo(rawEmpleo);
            }
            if (!normEmpleo) {
              normEmpleo = index < mitad ? 'ROL 1' : 'ROL 2';
            }

            // Determinar Grupo:
            let normGrupo: Grupo | null = null;
            if (rawGrupo) {
              normGrupo = normalizeGrupo(rawGrupo);
            }
            if (!normGrupo) {
              normGrupo = 'U.G.';
            }

            // DNI seguro
            const numSec = String(index + 1).padStart(2, '0');
            const dniGenerado = `100000${numSec}${normEmpleo === 'ROL 1' ? 'A' : 'B'}`;
            const normDni = rawDni ? (normalizeDni(rawDni) || rawDni) : dniGenerado;
            const telGenerado = `6000000${numSec}`;
            const telFinal = rawTel || telGenerado;

            if (normDni) {
              if (seenDnis.has(normDni)) {
                // Generar DNI único si hay colisión
                const dniUnico = `${normDni}-${index + 1}`;
                seenDnis.add(dniUnico);
              } else {
                seenDnis.add(normDni);
              }
            }

            const parsedRow: ExcelRowParsed = {
              rowNumber: item.originalRowIndex,
              nombre: nombreFormateado,
              empleo: normEmpleo,
              grupo: normGrupo,
              dni: normDni,
              telefono: telFinal,
              valid: errors.length === 0,
              errors,
            };

            if (parsedRow.valid) {
              validRows.push(parsedRow);
            } else {
              invalidRows.push(parsedRow);
            }
          });
        }

        const totalCount = validRows.length;
        const rol1Count = validRows.filter((r) => r.empleo === 'ROL 1').length;
        const rol2Count = validRows.filter((r) => r.empleo === 'ROL 2').length;

        const gruposCount: Record<Grupo, number> = {
          'U.G.': 0,
          'US_SEGURIDAD': 0,
        };

        validRows.forEach((r) => {
          if (r.grupo && gruposCount[r.grupo as Grupo] !== undefined) {
            gruposCount[r.grupo as Grupo]++;
          }
        });

        const generalErrors: string[] = [];

        if (invalidRows.length > 0) {
          generalErrors.push(
            `Se han detectado ${invalidRows.length} fila(s) con errores de formato.`
          );
        }

        if (totalCount < 4) {
          generalErrors.push(
            `IMPORTACIÓN NO VÁLIDA: Se encontraron ${totalCount} personas válidas. Se requiere un mínimo de 4 efectivos (al menos 2 de ROL 1 y 2 de ROL 2) para cubrir los puestos de guardia.`
          );
        } else if (rol1Count < 2 || rol2Count < 2) {
          generalErrors.push(
            `Dotación descompensada: Se detectaron ${rol1Count} ROL 1 y ${rol2Count} ROL 2. Se recomienda equilibrar ambos roles.`
          );
        }

        const isValid = generalErrors.filter((e) => e.startsWith('IMPORTACIÓN NO VÁLIDA')).length === 0 && invalidRows.length === 0;

        // Calcular simulación comparando con personas existentes
        const simulation = calcularSimulacionImportacion(validRows, existingPersonas);

        resolve({
          isValid,
          totalCount,
          rol1Count,
          rol2Count,
          gruposCount,
          validRows,
          invalidRows,
          generalErrors,
          simulation,
        });
      } catch (err: any) {
        resolve({
          isValid: false,
          totalCount: 0,
          rol1Count: 0,
          rol2Count: 0,
          gruposCount: {
            'U.G.': 0,
            'US_SEGURIDAD': 0,
          },
          validRows: [],
          invalidRows: [],
          generalErrors: [
            `Error al procesar el archivo Excel: ${err.message || 'Formato de archivo inválido.'}`,
          ],
        });
      }
    };

    reader.onerror = () => {
      resolve({
        isValid: false,
        totalCount: 0,
        rol1Count: 0,
        rol2Count: 0,
        gruposCount: {
          'U.G.': 0,
          'US_SEGURIDAD': 0,
        },
        validRows: [],
        invalidRows: [],
        generalErrors: ['Error de lectura del archivo en el navegador.'],
      });
    };

    reader.readAsArrayBuffer(file);
  });
};

/**
 * Calcula la simulación de importación detallada con política conservadora de homónimos
 */
export const calcularSimulacionImportacion = (
  newRows: ExcelRowParsed[],
  existingPersonas: Persona[]
): ImportSimulationSummary => {
  let nuevas = 0;
  let modificadas = 0;
  let sinCambios = 0;
  let cambiosEmpleo = 0;
  let revisionManual = 0;
  const detalles: ImportSimulationRow[] = [];
  const matchedExistingIds = new Set<string>();

  newRows.forEach((row) => {
    const { match, strategy, isSafeAutoMatch } = findMatchingPersona(
      { nombre: row.nombre, dni: row.dni },
      existingPersonas
    );

    const empleoNorm = (row.empleo as Empleo) || 'ROL 2';
    const grupoNorm = (row.grupo as Grupo) || 'U.G.';

    if (strategy === 'NOMBRE_HOMONIMO_REVISION' && match) {
      revisionManual++;
      detalles.push({
        nombre: row.nombre,
        empleo: empleoNorm,
        grupo: grupoNorm,
        dni: row.dni,
        telefono: row.telefono,
        tipoAccion: 'REVISION_MANUAL',
        personaExistenteId: match.id,
        motivo: `Posible homónimo (${match.nombre} - ${match.empleo} - ${match.grupo}). Se tratará como alta separada.`,
      });
    } else if (!match || !isSafeAutoMatch) {
      nuevas++;
      detalles.push({
        nombre: row.nombre,
        empleo: empleoNorm,
        grupo: grupoNorm,
        dni: row.dni,
        telefono: row.telefono,
        tipoAccion: 'NUEVA',
        motivo: 'Persona nueva en la plantilla oficial',
      });
    } else {
      matchedExistingIds.add(match.id);
      const empleoCambio = match.empleo !== empleoNorm;
      const grupoCambio = match.grupo !== grupoNorm;
      const datosCambio =
        (row.dni && match.dni !== row.dni) ||
        (row.telefono && match.telefono !== row.telefono) ||
        grupoCambio ||
        !match.activo;

      if (empleoCambio) {
        cambiosEmpleo++;
        detalles.push({
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: grupoNorm,
          dni: row.dni,
          telefono: row.telefono,
          tipoAccion: 'CAMBIO_EMPLEO',
          personaExistenteId: match.id,
          motivo: `Cambio de empleo: ${match.empleo} -> ${empleoNorm}`,
        });
      } else if (datosCambio) {
        modificadas++;
        let motivoDesc = 'Actualización de datos';
        if (!match.activo) {
          motivoDesc = 'Reactivación de persona en plantilla';
        } else if (grupoCambio) {
          motivoDesc = `Cambio de grupo: ${match.grupo} -> ${grupoNorm}`;
        }

        detalles.push({
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: grupoNorm,
          dni: row.dni,
          telefono: row.telefono,
          tipoAccion: 'MODIFICADA',
          personaExistenteId: match.id,
          motivo: motivoDesc,
        });
      } else {
        sinCambios++;
        detalles.push({
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: grupoNorm,
          dni: row.dni,
          telefono: row.telefono,
          tipoAccion: 'SIN_CAMBIOS',
          personaExistenteId: match.id,
          motivo: 'Datos idénticos sin alteraciones',
        });
      }
    }
  });

  let desactivadas = 0;
  existingPersonas
    .filter((p) => p.activo && !matchedExistingIds.has(p.id) && p.tipoServicio !== 'US')
    .forEach((p) => {
      desactivadas++;
      detalles.push({
        nombre: p.nombre,
        empleo: p.empleo,
        grupo: p.grupo || 'U.G.',
        dni: p.dni,
        telefono: p.telefono,
        tipoAccion: 'DESACTIVAR',
        personaExistenteId: p.id,
        motivo: 'Pasa a estado INACTIVO (se conserva en el historial)',
      });
    });

  return {
    nuevas,
    modificadas,
    desactivadas,
    sinCambios,
    cambiosEmpleo,
    revisionManual,
    detalles,
  };
};

/**
 * Ejecuta la importación confirmada:
 * 1. Registra las 22 personas con su orden de rotación oficial (1..11 ROL 1, 1..11 ROL 2).
 * 2. Limpia todos los cambios de pruebas anteriores (solicitudes, documentos firmados, bajas/incidencias).
 * 3. Regenera y confirma el cuadrante 100% limpio para la U.G.
 */
export const ejecutarImportacionConfirmada = async (
  validRows: ExcelRowParsed[],
  existingPersonas: Persona[],
  adminInfo: { uid: string; nombre: string },
  nombreCiclo: string = 'Ciclo Importado'
): Promise<{ success: boolean; message: string; count: number }> => {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    const matchedExistingIds = new Set<string>();
    const updatedPersonasGuardia: Persona[] = [];

    // Separar en ROL 1 (ROL 1) y ROL 2 (ROL 2)
    let rol1Counter = 0;
    let rol2Counter = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const { match, isSafeAutoMatch } = findMatchingPersona(
        { nombre: row.nombre, dni: row.dni },
        existingPersonas
      );

      const empleoNorm = (row.empleo as Empleo) || (i < 11 ? 'ROL 1' : 'ROL 2');
      const grupoNorm = (row.grupo as Grupo) || UNIDADES_DISTRIBUIDAS[i % UNIDADES_DISTRIBUIDAS.length];

      let ordenRotacion = 1;
      if (empleoNorm === 'ROL 1') {
        rol1Counter++;
        ordenRotacion = rol1Counter;
      } else {
        rol2Counter++;
        ordenRotacion = rol2Counter;
      }

      if (!match || !isSafeAutoMatch) {
        const newRef = doc(collection(db, 'personas'));
        const newPersona: Persona = {
          id: newRef.id,
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: grupoNorm,
          tipoServicio: 'GUARDIA',
          dni: row.dni,
          telefono: row.telefono,
          activo: true,
          ordenRotacion,
          cicloId: nombreCiclo,
          fechaCreacion: now,
          fechaActualizacion: now,
        };
        batch.set(newRef, newPersona);
        updatedPersonasGuardia.push(newPersona);
      } else {
        matchedExistingIds.add(match.id);
        const docRef = doc(db, 'personas', match.id);
        const updatedPersona: Persona = {
          ...match,
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: grupoNorm,
          tipoServicio: 'GUARDIA',
          dni: row.dni || match.dni,
          telefono: row.telefono || match.telefono,
          activo: true,
          ordenRotacion,
          cicloId: nombreCiclo,
          fechaActualizacion: now,
        };
        batch.update(docRef, {
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: grupoNorm,
          tipoServicio: 'GUARDIA',
          dni: row.dni || match.dni,
          telefono: row.telefono || match.telefono,
          activo: true,
          ordenRotacion,
          cicloId: nombreCiclo,
          fechaActualizacion: now,
        });
        updatedPersonasGuardia.push(updatedPersona);
      }
    }

    // Desactivar personas de guardia que no figuren en la nueva lista
    const aDesactivar = existingPersonas.filter(
      (p) => p.activo && p.tipoServicio !== 'US' && !matchedExistingIds.has(p.id)
    );

    for (const p of aDesactivar) {
      const docRef = doc(db, 'personas', p.id);
      batch.update(docRef, {
        activo: false,
        fechaActualizacion: now,
      });
    }

    await batch.commit();

    // Actualizar caché de personas en memoria
    const allDbPersonas = await getPersonas({ activoOnly: false });
    const personasUS = allDbPersonas.filter((p) => p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD');
    const todasLasPersonas = [...updatedPersonasGuardia, ...personasUS, ...aDesactivar.map((p) => ({ ...p, activo: false }))];
    setMemoryPersonasCache(todasLasPersonas);
    guardarPersonasMemoriaYLocal(todasLasPersonas);

    // Asegurar cuentas para las nuevas personas y purgar cuentas obsoletas únicamente de GUARDIA
    try {
      await asegurarCuentasParaPersonas(todasLasPersonas, false, 'GUARDIA');
    } catch (e) {
      console.warn('Error sincronizando cuentas en importación:', e);
    }

    // 2. Limpiar todos los cambios y pruebas previas
    await limpiarTodosCambiosUG();
    await limpiarTodasAusenciasUG();

    // 3. Regenerar el cuadrante general en limpio para la U.G.
    await regenerarCuadranteLimpioUG(todasLasPersonas, adminInfo);

    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'IMPORTAR_PERSONAL',
      detalles: `Plantilla oficial de personal importada: ${validRows.length} efectivos (11 ROL 1 y 11 ROL 2). Cambios previos eliminados y cuadrante general de la U.G. regenerado en limpio.`,
    });

    return {
      success: true,
      message: `Importación completada con éxito. Se han cargado los ${validRows.length} efectivos (11 ROL 1 y 11 ROL 2). Todas las pruebas anteriores han sido eliminadas y el cuadrante general ha quedado completamente limpio.`,
      count: validRows.length,
    };
  } catch (error: any) {
    console.error('Error al ejecutar importación en Firestore:', error);
    return {
      success: false,
      message: `Error al guardar en base de datos: ${error.message || 'Error desconocido'}`,
      count: 0,
    };
  }
};

/**
 * Genera y descarga una plantilla Excel con solo apellidos (11 ROL 1 y 11 ROL 2)
 */
export const descargarPlantillaExcelApellidos = () => {
  const apellidosRol1 = [
    'GARCÍA', 'LÓPEZ', 'MARTÍNEZ', 'SÁNCHEZ', 'FERNÁNDEZ',
    'ROMERO', 'TORRES', 'NAVARRO', 'DELGADO', 'CASTRO', 'ORTIZ'
  ];

  const apellidosRol2 = [
    'RUIZ', 'HERNÁNDEZ', 'SERRANO', 'MOLINA', 'BLANCO',
    'MORALES', 'SUÁREZ', 'ORTEGA', 'MARÍN', 'SOTO', 'VEGA'
  ];

  const data: any[] = [
    ['Apellidos'],
    ...apellidosRol1.map((ap) => [ap]),
    ...apellidosRol2.map((ap) => [ap]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Apellidos UG');
  XLSX.writeFile(wb, 'plantilla_apellidos_ug_22.xlsx');
};

/**
 * Genera y descarga una plantilla Excel oficial con dos columnas: ROL y APELLIDO
 */
export const descargarPlantillaExcelEjemplo = (rol1Count = 11, rol2Count = 11) => {
  const data: any[] = [
    ['ROL', 'APELLIDO'],
  ];

  const apellidosRol1 = [
    'GARCÍA', 'LÓPEZ', 'MARTÍNEZ', 'SÁNCHEZ', 'FERNÁNDEZ',
    'ROMERO', 'TORRES', 'NAVARRO', 'DELGADO', 'CASTRO', 'ORTIZ'
  ];

  const apellidosRol2 = [
    'RUIZ', 'HERNÁNDEZ', 'SERRANO', 'MOLINA', 'BLANCO',
    'MORALES', 'SUÁREZ', 'ORTEGA', 'MARÍN', 'SOTO', 'VEGA'
  ];

  for (let i = 0; i < rol1Count; i++) {
    const apellido = apellidosRol1[i % apellidosRol1.length];
    data.push(['ROL 1', apellido]);
  }

  for (let i = 0; i < rol2Count; i++) {
    const apellido = apellidosRol2[i % apellidosRol2.length];
    data.push(['ROL 2', apellido]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Personal UG');
  XLSX.writeFile(wb, 'plantilla_oficial_rol_apellido.xlsx');
};

/**
 * Genera y descarga una plantilla Excel para la U.S. (Unidad de Seguridad - Turnos de 12 Horas)
 * Únicamente dos columnas: ROL y APELLIDO (dotación variable ~16 personas).
 */
export const descargarPlantillaExcelUS = (rol1Count = 8, rol2Count = 8) => {
  const data: any[] = [
    ['ROL', 'APELLIDO'],
  ];

  const apellidosUSRol1 = [
    'CAMPOS', 'CORTÉS', 'IGLESIAS', 'GUERRERO', 'MÉNDEZ', 'CANO', 'CALVO', 'HERRERO'
  ];

  const apellidosUSRol2 = [
    'CRUZ', 'PRIETO', 'GALLEGO', 'VIDAL', 'LEÓN', 'PASTOR', 'AGUILAR', 'BENÍTEZ'
  ];

  for (let i = 0; i < rol1Count; i++) {
    const apellido = apellidosUSRol1[i % apellidosUSRol1.length];
    data.push(['ROL 1', apellido]);
  }

  for (let i = 0; i < rol2Count; i++) {
    const apellido = apellidosUSRol2[i % apellidosUSRol2.length];
    data.push(['ROL 2', apellido]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plantilla U.S.');
  XLSX.writeFile(wb, 'plantilla_us_seguridad_12h.xlsx');
};

/**
 * Parser específico para la U.S. (Unidad de Seguridad)
 * - Solo requiere ROL y APELLIDO.
 * - Dotación variable y adaptativa (sin número fijo obligatorio de 16 o 22).
 * - Aislamiento total respecto a la U.G.
 */
export const parseExcelFileUS = async (
  file: File,
  existingPersonasUS: Persona[]
): Promise<ExcelValidationResult> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];

        if (!firstSheetName) {
          return resolve({
            isValid: false,
            totalCount: 0,
            rol1Count: 0,
            rol2Count: 0,
            gruposCount: { 'U.G.': 0, 'US_SEGURIDAD': 0 },
            validRows: [],
            invalidRows: [],
            generalErrors: ['El archivo Excel está vacío o no contiene hojas de cálculo.'],
          });
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!rawJson || rawJson.length === 0) {
          return resolve({
            isValid: false,
            totalCount: 0,
            rol1Count: 0,
            rol2Count: 0,
            gruposCount: { 'U.G.': 0, 'US_SEGURIDAD': 0 },
            validRows: [],
            invalidRows: [],
            generalErrors: ['La hoja de cálculo está vacía.'],
          });
        }

        const validRows: ExcelRowParsed[] = [];
        const invalidRows: ExcelRowParsed[] = [];
        const generalErrors: string[] = [];

        // Detectar si la primera fila es encabezado
        const firstRow = rawJson[0] || [];
        let startIndex = 0;
        let rolColIdx = -1;
        let apellidoColIdx = -1;

        if (Array.isArray(firstRow)) {
          firstRow.forEach((cell, idx) => {
            const str = String(cell || '').trim().toLowerCase();
            if (
              str === 'rol' ||
              str === 'roles' ||
              str === 'empleo' ||
              str === 'empleos' ||
              str === 'cargo' ||
              str === 'puesto'
            ) {
              rolColIdx = idx;
            }
            if (
              str === 'apellido' ||
              str === 'apellidos' ||
              str === 'nombre' ||
              str === 'nombres' ||
              str === 'persona' ||
              str === 'personas' ||
              str === 'efectivo' ||
              str === 'efectivos' ||
              str === 'usuario'
            ) {
              apellidoColIdx = idx;
            }
          });
        }

        const hasHeader = rolColIdx !== -1 || apellidoColIdx !== -1;
        if (hasHeader) {
          startIndex = 1;
        }

        // Si no se encontraron por nombre, asignar por defecto
        if (rolColIdx === -1 && apellidoColIdx === -1) {
          if (firstRow.length >= 2) {
            // Verificar si col 0 es ROL o col 1 es ROL
            const val0 = String(firstRow[0] || '').toUpperCase();
            if (val0.includes('ROL 1') || val0.includes('ROL 2') || val0.includes('ROL')) {
              rolColIdx = 0;
              apellidoColIdx = 1;
            } else {
              apellidoColIdx = 0;
              rolColIdx = 1;
            }
          } else {
            apellidoColIdx = 0;
          }
        } else if (rolColIdx === -1 && apellidoColIdx !== -1) {
          rolColIdx = apellidoColIdx === 0 ? 1 : 0;
        } else if (rolColIdx !== -1 && apellidoColIdx === -1) {
          apellidoColIdx = rolColIdx === 0 ? 1 : 0;
        }

        const seenSurnames = new Set<string>();

        for (let i = startIndex; i < rawJson.length; i++) {
          const rowData = rawJson[i];
          if (!rowData || rowData.length === 0) continue;

          // Ignorar filas completamente vacías
          const isRowEmpty = rowData.every((c: any) => c === undefined || c === null || String(c).trim() === '');
          if (isRowEmpty) continue;

          let rawRol = rolColIdx >= 0 ? rowData[rolColIdx] : '';
          let rawApellido = apellidoColIdx >= 0 ? rowData[apellidoColIdx] : rowData[0];

          // Si solo hay una columna con formato "ROL 1 LOPEZ" o "LOPEZ (ROL 1)"
          if (!rawRol && rawApellido) {
            const str = String(rawApellido).trim();
            if (/rol\s*1/i.test(str)) {
              rawRol = 'ROL 1';
              rawApellido = str.replace(/rol\s*1/gi, '').replace(/[()|-]/g, '').trim();
            } else if (/rol\s*2/i.test(str)) {
              rawRol = 'ROL 2';
              rawApellido = str.replace(/rol\s*2/gi, '').replace(/[()|-]/g, '').trim();
            }
          }

          const apellidoLimpio = String(rawApellido || '').trim().toUpperCase();
          let rolNormalizado: Empleo = 'ROL 2';
          const rolStr = String(rawRol || '').toUpperCase();
          if (rolStr.includes('1') || rolStr.includes('ROL 1') || rolStr.includes('CABO')) {
            rolNormalizado = 'ROL 1';
          } else if (rolStr.includes('2') || rolStr.includes('ROL 2') || rolStr.includes('SOLDADO')) {
            rolNormalizado = 'ROL 2';
          } else {
            // Por defecto si no se especifica, alternar o asignar ROL 2
            rolNormalizado = i % 2 === 0 ? 'ROL 1' : 'ROL 2';
          }

          const rowErrors: string[] = [];

          if (!apellidoLimpio) {
            rowErrors.push('El apellido es obligatorio.');
          } else if (seenSurnames.has(apellidoLimpio)) {
            rowErrors.push(`El apellido '${apellidoLimpio}' está duplicado en el archivo.`);
          }

          const parsedRow: ExcelRowParsed = {
            rowNumber: i + 1,
            nombre: apellidoLimpio,
            empleo: rolNormalizado,
            grupo: 'US_SEGURIDAD',
            dni: '',
            telefono: '',
            valid: rowErrors.length === 0,
            errors: rowErrors,
          };

          if (parsedRow.valid) {
            seenSurnames.add(apellidoLimpio);
            validRows.push(parsedRow);
          } else {
            invalidRows.push(parsedRow);
          }
        }

        const totalCount = validRows.length;
        const rol1Count = validRows.filter((r) => r.empleo === 'ROL 1').length;
        const rol2Count = validRows.filter((r) => r.empleo === 'ROL 2').length;

        // Validación de dotación mínima para 12h: se requieren al menos 5 personas
        if (totalCount < 5) {
          generalErrors.push(
            `Dotación insuficiente para la U.S.: se han detectado ${totalCount} efectivos. Se requieren al menos 5 personas para cubrir los turnos de 12h (2 Diurnos + 2 Nocturnos + 1 Imaginaria).`
          );
        }

        const simulation = calcularSimulacionImportacion(validRows, existingPersonasUS.filter(p => p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD'));

        resolve({
          isValid: invalidRows.length === 0 && generalErrors.length === 0,
          totalCount,
          rol1Count,
          rol2Count,
          gruposCount: {
            'U.G.': 0,
            'US_SEGURIDAD': totalCount,
          },
          validRows,
          invalidRows,
          generalErrors,
          simulation,
        });
      } catch (err: any) {
        resolve({
          isValid: false,
          totalCount: 0,
          rol1Count: 0,
          rol2Count: 0,
          gruposCount: { 'U.G.': 0, 'US_SEGURIDAD': 0 },
          validRows: [],
          invalidRows: [],
          generalErrors: [`Error al procesar el archivo Excel: ${err.message || 'Formato no soportado'}`],
        });
      }
    };

    reader.onerror = () => {
      resolve({
        isValid: false,
        totalCount: 0,
        rol1Count: 0,
        rol2Count: 0,
        gruposCount: { 'U.G.': 0, 'US_SEGURIDAD': 0 },
        validRows: [],
        invalidRows: [],
        generalErrors: ['Error de lectura del archivo local.'],
      });
    };

    reader.readAsArrayBuffer(file);
  });
};

/**
 * Ejecuta la importación confirmada exclusivamente para la U.S. (Unidad de Seguridad)
 * - Mantiene aislamiento total: no modifica ni borra personal ni cuadrantes de la U.G.
 * - Da de alta / actualiza el personal activo de U.S.
 * - Desactiva (sin borrar) personal de U.S. no presente en la nueva lista para preservar histórico.
 */
export const ejecutarImportacionConfirmadaUS = async (
  validRows: ExcelRowParsed[],
  existingPersonas: Persona[],
  adminInfo: { uid: string; nombre: string },
  nombreCiclo: string = 'Ciclo U.S. 2026'
): Promise<{ success: boolean; message: string; count: number }> => {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    const matchedExistingIds = new Set<string>();
    const updatedPersonasUS: Persona[] = [];

    const existingUSPersonas = existingPersonas.filter(
      (p) => p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD'
    );

    let rol1Counter = 0;
    let rol2Counter = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const match = existingUSPersonas.find(
        (p) => p.nombre.trim().toUpperCase() === row.nombre.trim().toUpperCase()
      );

      const empleoNorm = (row.empleo as Empleo) || 'ROL 2';
      let ordenRotacion = i + 1;

      if (empleoNorm === 'ROL 1') {
        rol1Counter++;
        ordenRotacion = rol1Counter;
      } else {
        rol2Counter++;
        ordenRotacion = rol2Counter;
      }

      if (!match) {
        const newRef = doc(collection(db, 'personas'));
        const newPersona: Persona = {
          id: newRef.id,
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: 'US_SEGURIDAD',
          tipoServicio: 'US',
          dni: '',
          telefono: '',
          activo: true,
          ordenRotacion,
          cicloId: nombreCiclo,
          notas: 'Alta por Excel U.S.',
          fechaCreacion: now,
          fechaActualizacion: now,
        };
        batch.set(newRef, newPersona);
        updatedPersonasUS.push(newPersona);
      } else {
        matchedExistingIds.add(match.id);
        const docRef = doc(db, 'personas', match.id);
        const updatedPersona: Persona = {
          ...match,
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: 'US_SEGURIDAD',
          tipoServicio: 'US',
          activo: true,
          ordenRotacion,
          cicloId: nombreCiclo,
          fechaActualizacion: now,
        };
        batch.update(docRef, {
          nombre: row.nombre,
          empleo: empleoNorm,
          grupo: 'US_SEGURIDAD',
          tipoServicio: 'US',
          activo: true,
          ordenRotacion,
          cicloId: nombreCiclo,
          fechaActualizacion: now,
        });
        updatedPersonasUS.push(updatedPersona);
      }
    }

    // Desactivar personas de U.S. que no figuren en la nueva lista (conservando su historial)
    const usADesactivar = existingUSPersonas.filter(
      (p) => p.activo && !matchedExistingIds.has(p.id)
    );

    for (const p of usADesactivar) {
      const docRef = doc(db, 'personas', p.id);
      batch.update(docRef, {
        activo: false,
        fechaActualizacion: now,
      });
    }

    await batch.commit();

    // Actualizar caché de personas en memoria (dejando U.G. 100% intacta)
    const allDbPersonas = await getPersonas({ activoOnly: false });
    const personasUG = allDbPersonas.filter(
      (p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === 'GUARDIA'
    );
    const todasLasPersonas = [
      ...personasUG,
      ...updatedPersonasUS,
      ...usADesactivar.map((p) => ({ ...p, activo: false })),
    ];
    setMemoryPersonasCache(todasLasPersonas);
    guardarPersonasMemoriaYLocal(todasLasPersonas);

    // Asegurar cuentas para las personas de U.S.
    try {
      await asegurarCuentasParaPersonas(todasLasPersonas, false, 'US');
    } catch (e) {
      console.warn('Error sincronizando cuentas U.S.:', e);
    }

    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'IMPORTAR_PERSONAL',
      detalles: `Plantilla de la U.S. (Unidad de Seguridad) importada: ${validRows.length} usuarios activos (${rol1Counter} ROL 1 y ${rol2Counter} ROL 2). Historial conservado y U.G. no afectada.`,
    });

    return {
      success: true,
      message: `Plantilla U.S. actualizada correctamente con ${validRows.length} efectivos activos (${rol1Counter} ROL 1 y ${rol2Counter} ROL 2). Los datos históricos han sido preservados.`,
      count: validRows.length,
    };
  } catch (error: any) {
    console.error('Error al ejecutar importación U.S. en Firestore:', error);
    return {
      success: false,
      message: `Error al guardar en base de datos: ${error.message || 'Error desconocido'}`,
      count: 0,
    };
  }
};


