import {
  MatriculaNormalizadaResultado,
  TipoFormatoMatricula,
  EstadoValidacionMatricula,
  FilaImportacionExcelMatricula,
  ResumenPrevisualizacionExcelMatriculas,
} from '../../types/matriculaTypes';

// Prefijos provinciales oficiales históricos válidos en España (1900-2000)
export const PREFIJOS_PROVINCIALES_ESP: ReadonlySet<string> = new Set([
  'A',   // Alicante
  'AB',  // Albacete
  'AL',  // Almería
  'AV',  // Ávila
  'B',   // Barcelona
  'BA',  // Badajoz
  'BI',  // Bilbao (Bizkaia)
  'BU',  // Burgos
  'C',   // La Coruña
  'CA',  // Cádiz
  'CC',  // Cáceres
  'CS',  // Castellón
  'CR',  // Ciudad Real
  'CO',  // Córdoba
  'CU',  // Cuenca
  'GE',  // Gerona (hasta 1992)
  'GI',  // Girona (desde 1992)
  'GR',  // Granada
  'GU',  // Guadalajara
  'H',   // Huelva
  'HU',  // Huesca
  'J',   // Jaén
  'L',   // Lérida / Lleida
  'LE',  // León
  'LO',  // Logroño (La Rioja)
  'LU',  // Lugo
  'M',   // Madrid
  'MA',  // Málaga
  'ML',  // Melilla
  'MU',  // Murcia
  'NA',  // Navarra / Pamplona
  'O',   // Oviedo (Asturias)
  'OR',  // Orense (hasta 1998)
  'OU',  // Ourense (desde 1998)
  'P',   // Palencia
  'PM',  // Palma de Mallorca (hasta 1997)
  'IB',  // Illes Balears (desde 1997)
  'PO',  // Pontevedra
  'S',   // Santander (Cantabria)
  'SA',  // Salamanca
  'SE',  // Sevilla
  'SG',  // Segovia
  'SO',  // Soria
  'SS',  // San Sebastián (Gipuzkoa)
  'T',   // Tarragona
  'TE',  // Teruel
  'TF',  // Santa Cruz de Tenerife
  'TO',  // Toledo
  'V',   // Valencia
  'VA',  // Valladolid
  'VI',  // Vitoria (Álava)
  'Z',   // Zaragoza
  'ZA',  // Zamora
  'CE',  // Ceuta
]);

// Prefijos oficiales de Fuerzas y Cuerpos de Seguridad y Estado en España
export const PREFIJOS_OFICIALES_ESP: ReadonlySet<string> = new Set([
  'PGC', // Guardia Civil
  'CNP', // Cuerpo Nacional de Policía
  'ET',  // Ejército de Tierra
  'EA',  // Ejército del Aire
  'FN',  // Fuerzas Navales / Armada
  'CME', // Mossos d'Esquadra
  'DGP', // Dirección General de Policía
  'PMM', // Policía Municipal Madrid / Local
  'PME', // Parque Móvil del Estado
  'MF',  // Ministerio de Fomento
  'MMA', // Medio Ambiente
]);

/**
 * Limpia comillas envolventes externas y espacios superfluos en los extremos,
 * preservando los caracteres y separadores internos originales.
 */
export const limpiarValorOriginal = (raw: string): string => {
  let s = raw.trim();
  // Eliminar comillas dobles o simples externas repetidas (ej. "" 1234-abC "" -> 1234-abC)
  while (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
};

/**
 * Normaliza y clasifica deterministamente una matrícula.
 * Conserva siempre el valor original, genera un valor limpio y una clave canónica alfanumérica.
 * 
 * Reglas de estados:
 * - VALIDA: Encaja fehacientemente con un patrón oficial español (Moderno, Provincial Alfa/Num, Especial, Fuerzas).
 * - DUDOSA: Valor interpretable alfanumérico pero no coincide con patrones españoles (ej. FORMATO_GENERICO)
 *           o con ambigüedad que exige revisión por un operador. NUNCA se aprueba silenciosamente.
 * - INVALIDA: Cadena vacía, longitud no admitida o caracteres no alfanuméricos.
 */
export const normalizarMatricula = (raw: string | number | null | undefined): MatriculaNormalizadaResultado => {
  const originalStr = raw === null || raw === undefined ? '' : String(raw);
  const valorLimpio = limpiarValorOriginal(originalStr);

  if (!valorLimpio) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio: '',
      matriculaNormalizada: '',
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: ['Matrícula vacía o en blanco'],
      motivoInvalidez: 'Matrícula vacía o en blanco',
    };
  }

  // 1. Clave canónica: Mayúsculas sin separadores (espacios, guiones, barras, puntos, etc.)
  // Normalizamos diacríticos de vocales (Á, É, Í, Ó, Ú, etc.) protegiendo la Ñ
  // para que una matrícula con Ñ no se convierta silenciosamente en N
  const mayusculasLimpio = valorLimpio.toUpperCase();
  const conNProtegida = mayusculasLimpio.replace(/Ñ/g, '__ENIE__');
  const sinAcentos = conNProtegida
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/__ENIE__/g, 'Ñ');

  const normalizada = sinAcentos
    .replace(/[\s\-_./\\'"`,;:]/g, '');

  // 2. Comprobar que solo contiene caracteres alfanuméricos (incluida Ñ como carácter analizable)
  if (!/^[A-Z0-9Ñ]+$/.test(normalizada)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: ['Contiene caracteres no alfanuméricos o símbolos no permitidos'],
      motivoInvalidez: 'Contiene caracteres no alfanuméricos o símbolos no permitidos',
    };
  }

  // 3. Comprobar límites de longitud razonable (3 a 10 caracteres)
  if (normalizada.length < 3 || normalizada.length > 10) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: [`Longitud de ${normalizada.length} caracteres fuera del rango permitido (3 a 10)`],
      motivoInvalidez: `Longitud de ${normalizada.length} caracteres fuera del rango permitido (3 a 10)`,
    };
  }

  // 3.1 Filtro estricto de privacidad y descarte de datos personales (DNI, NIE, CIF, Teléfonos, Fechas)
  // DNI español: 8 dígitos y 1 letra final (ej. 12345678Z)
  if (/^\d{8}[A-Z]$/.test(normalizada)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: ['Patrón identificado como DNI personal (descartado automáticamente sin almacenar)'],
      motivoInvalidez: 'DNI personal descartado por privacidad',
    };
  }

  // NIE español: X, Y o Z seguido de 7 dígitos y 1 letra (ej. X1234567Z)
  if (/^[XYZ]\d{7}[A-Z]$/.test(normalizada)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: ['Patrón identificado como NIE / Extranjería (descartado por privacidad)'],
      motivoInvalidez: 'NIE descartado por privacidad',
    };
  }

  // CIF: 1 letra fiscal + 7 dígitos + 1 control (ej. B12345678)
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(normalizada)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: ['Patrón identificado como CIF de entidad (descartado)'],
      motivoInvalidez: 'CIF descartado',
    };
  }

  // Teléfonos o códigos solo numéricos largos
  if (/^\d{8,12}$/.test(normalizada)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: ['Cadena numérica (teléfono o código postal) no correspondiente a matrícula'],
      motivoInvalidez: 'Número telefónico / código descartado',
    };
  }

  // Fechas (ej: 25/09/2026, 2026-09-25)
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(valorLimpio) || /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(valorLimpio)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'DESCONOCIDO_INVALIDO',
      formato: 'DESCONOCIDO_INVALIDO',
      estadoValidacion: 'INVALIDA',
      esValida: false,
      incidencias: ['Formato de fecha detectado'],
      motivoInvalidez: 'Fecha descartada',
    };
  }

  // 4. Identificación determinista de Formatos Oficiales Españoles:

  // 4.1 Formato Oficial Fuerzas y Cuerpos de Seguridad / Estado (ej. PGC1234A, CNP98765, CME1234)
  for (const pref of PREFIJOS_OFICIALES_ESP) {
    if (normalizada.startsWith(pref)) {
      const resto = normalizada.slice(pref.length);
      if (/^\d{3,6}[A-Z]?$/.test(resto)) {
        return {
          matriculaOriginal: originalStr,
          valorLimpio,
          matriculaNormalizada: normalizada,
          formatoDetectado: 'OFICIAL_FUERZAS',
          formato: 'OFICIAL_FUERZAS',
          estadoValidacion: 'VALIDA',
          esValida: true,
          incidencias: [],
        };
      }
    }
  }

  // 4.2 Formato Especial / Ciclomotores / Remolques / Históricos (C1234BBB, E1234BBB, R1234BBB, H1234BBB)
  const regexEspecial = /^([CERH])(\d{4})([A-Z]{1,3})$/;
  if (regexEspecial.test(normalizada)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'ESPECIAL_CICLOMOTOR',
      formato: 'ESPECIAL_CICLOMOTOR',
      estadoValidacion: 'VALIDA',
      esValida: true,
      incidencias: [],
    };
  }

  // 4.3 Formato Nacional Moderno Español (desde el año 2000): 4 dígitos + 3 consonantes DGT
  // Alfabeto oficial exclusivo: B, C, D, F, G, H, J, K, L, M, N, P, R, S, T, V, W, X, Y, Z
  // Excluye expresamente vocales (A, E, I, O, U), la Ñ y la Q.
  const regexModerno = /^(\d{4})([BCDFGHJKLMNPRSTVWXYZ]{3})$/;
  if (regexModerno.test(normalizada)) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'MODERNO_ESP',
      formato: 'MODERNO_ESP',
      estadoValidacion: 'VALIDA',
      esValida: true,
      incidencias: [],
    };
  }

  // 4.4 Formato Provincial Antiguo Alfanumérico (1971-2000): 1-2 letras provinciales + exactamente 4 dígitos + 1-2 letras
  const regexProvAlfa = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/;
  const matchProvAlfa = normalizada.match(regexProvAlfa);
  if (matchProvAlfa) {
    const prefijo = matchProvAlfa[1];
    if (PREFIJOS_PROVINCIALES_ESP.has(prefijo)) {
      return {
        matriculaOriginal: originalStr,
        valorLimpio,
        matriculaNormalizada: normalizada,
        formatoDetectado: 'PROVINCIAL_ALFA',
        formato: 'PROVINCIAL_ALFA',
        estadoValidacion: 'VALIDA',
        esValida: true,
        incidencias: [],
      };
    }
  }

  // 4.5 Formato Provincial Numérico Antiguo (1900-1971): 1-2 letras provinciales + 1 a 6 dígitos (ej. M123456, B78901)
  const regexProvNum = /^([A-Z]{1,2})(\d{1,6})$/;
  const matchProvNum = normalizada.match(regexProvNum);
  if (matchProvNum) {
    const prefijo = matchProvNum[1];
    if (PREFIJOS_PROVINCIALES_ESP.has(prefijo)) {
      return {
        matriculaOriginal: originalStr,
        valorLimpio,
        matriculaNormalizada: normalizada,
        formatoDetectado: 'PROVINCIAL_NUM',
        formato: 'PROVINCIAL_NUM',
        estadoValidacion: 'VALIDA',
        esValida: true,
        incidencias: [],
      };
    }
  }

  // 4.6 Formato Genérico / Internacional / Dudoso:
  // Si contiene letras y números pero no encaja con ningún formato oficial español,
  // NO se autoriza automáticamente como VALIDA: se clasifica SIEMPRE como DUDOSA para revisión.
  const tieneLetra = /[A-ZÑ]/.test(normalizada);
  const tieneNumero = /[0-9]/.test(normalizada);
  if (tieneLetra && tieneNumero && normalizada.length >= 4 && normalizada.length <= 10) {
    return {
      matriculaOriginal: originalStr,
      valorLimpio,
      matriculaNormalizada: normalizada,
      formatoDetectado: 'FORMATO_GENERICO',
      formato: 'FORMATO_GENERICO',
      estadoValidacion: 'DUDOSA', // Regla estricta: NUNCA VALIDA AUTOMÁTICAMENTE
      esValida: false,
      incidencias: [
        'Formato alfanumérico no catalogado en los estándares oficiales españoles; registrado como DUDOSA para revisión manual',
      ],
      motivoInvalidez: 'Formato no estándar español (pendiente de revisión)',
    };
  }

  // 4.7 Desconocido / No interpretable
  return {
    matriculaOriginal: originalStr,
    valorLimpio,
    matriculaNormalizada: normalizada,
    formatoDetectado: 'DESCONOCIDO_INVALIDO',
    formato: 'DESCONOCIDO_INVALIDO',
    estadoValidacion: 'INVALIDA',
    esValida: false,
    incidencias: ['Patrón no interpretable como matrícula de vehículo'],
    motivoInvalidez: 'Patrón no interpretable como matrícula de vehículo',
  };
};

/**
 * Procesa un lote de valores leídos de un archivo Excel.
 * - Conserva el valor original íntegro de cada fila.
 * - Detecta duplicados internos informando exactamente qué filas colisionan.
 * - Clasifica deterministamente en Válidas, Dudosas e Inválidas.
 * - NINGÚN error en una fila interrumpe el análisis del resto del archivo.
 */
export const previsualizarLoteMatriculas = (
  valoresBrutos: (string | number | null | undefined)[],
  matriculasExistentesNormalizadas: Set<string> = new Set()
): ResumenPrevisualizacionExcelMatriculas => {
  // Mapa de clave normalizada -> array de números de fila (1-indexed) que la contienen
  const mapaColisiones = new Map<string, number[]>();

  // Primer paso: normalizar y mapear colisiones
  const resultadosPreliminares = valoresBrutos.map((val, idx) => {
    const rawStr = val === null || val === undefined ? '' : String(val);
    const resultado = normalizarMatricula(val);
    const filaNumero = idx + 1;

    if (resultado.matriculaNormalizada) {
      const lista = mapaColisiones.get(resultado.matriculaNormalizada) || [];
      lista.push(filaNumero);
      mapaColisiones.set(resultado.matriculaNormalizada, lista);
    }

    return {
      filaIndice: filaNumero,
      valorOriginal: rawStr,
      resultado,
    };
  });

  const filas: FilaImportacionExcelMatricula[] = [];
  const clavesVistas = new Set<string>();

  let validas = 0;
  let dudosas = 0;
  let invalidas = 0;
  let duplicadas = 0;

  for (const item of resultadosPreliminares) {
    const { filaIndice, valorOriginal, resultado } = item;
    const clave = resultado.matriculaNormalizada;

    let esDuplicadaEnArchivo = false;
    let esDuplicadaEnBaseDatos = false;
    let filasColisionadas: number[] = [];

    if (clave) {
      const todasLasFilasConEstaClave = mapaColisiones.get(clave) || [];
      filasColisionadas = todasLasFilasConEstaClave.filter((f) => f !== filaIndice);

      if (clavesVistas.has(clave)) {
        esDuplicadaEnArchivo = true;
        duplicadas++;
      } else {
        clavesVistas.add(clave);
        if (todasLasFilasConEstaClave.length > 1) {
          duplicadas++; // Contabilizar que esta clave tiene duplicados
        }
      }

      if (matriculasExistentesNormalizadas.has(clave)) {
        esDuplicadaEnBaseDatos = true;
      }
    }

    // Contabilización según estado determinista
    if (resultado.estadoValidacion === 'VALIDA') {
      validas++;
    } else if (resultado.estadoValidacion === 'DUDOSA') {
      dudosas++;
    } else {
      invalidas++;
    }

    // Solo se autoselecciona para importar si es 100% VALIDA y no está duplicada
    const seleccionadaParaImportar =
      resultado.estadoValidacion === 'VALIDA' &&
      !esDuplicadaEnArchivo &&
      !esDuplicadaEnBaseDatos;

    filas.push({
      filaIndice,
      valorOriginal,
      resultadoNormalizacion: resultado,
      esDuplicadaEnArchivo,
      esDuplicadaEnBaseDatos,
      filasColisionadas,
      seleccionadaParaImportar,
    });
  }

  return {
    totalLeidas: valoresBrutos.length,
    validas,
    dudosas,
    invalidas,
    duplicadas,
    filas,
  };
};

/**
 * Extrae todas las matrículas detectadas dentro de una celda cualquiera de una hoja de cálculo.
 * Funciona de manera inteligente para celdas que contienen una sola matrícula, múltiples matrículas
 * (separadas por barra, coma, guion, punto y coma, salto de línea) o matrículas precedidas de palabras descriptivas.
 * 
 * Regla Fundamental de Privacidad:
 * Descarta inmediatamente nombres de personas, DNI, NIE, CIF, números de teléfono, correos electrónicos,
 * fechas y direcciones sin almacenarlos en ningún sitio.
 */
export const extraerCandidatosMatriculaDeCelda = (rawCelda: any): string[] => {
  if (rawCelda === null || rawCelda === undefined) return [];
  if (typeof rawCelda === 'boolean') return [];

  const str = String(rawCelda).trim();
  if (!str || str.length < 3) return [];

  // Descarte rápido de correos electrónicos
  if (str.includes('@')) return [];

  // Descarte rápido de textos descriptivos excesivamente largos
  if (str.length > 200) return [];

  // 1. Descarte estricto de datos personales (DNI, NIE, CIF, Teléfonos, Fechas)
  const normDirecta = normalizarMatricula(str);
  if (
    normDirecta.motivoInvalidez?.includes('DNI') ||
    normDirecta.motivoInvalidez?.includes('NIE') ||
    normDirecta.motivoInvalidez?.includes('CIF') ||
    normDirecta.motivoInvalidez?.includes('teléfono') ||
    normDirecta.motivoInvalidez?.includes('Fecha')
  ) {
    return [];
  }

  // 2. Si la celda completa es directamente una matrícula oficial válida
  if (normDirecta.estadoValidacion === 'VALIDA') {
    return [str];
  }

  // 3. Extracción mediante patrones de expresión regular oficiales españoles (para multi-matrícula o texto mixto)
  const candidatosEncontrados: string[] = [];
  const normalizadosVistos = new Set<string>();

  // Patrón 1: Formato Especial / Ciclomotor / Remolque (ej: C-1234-BBB, R-1234-BBB, E-1234-BBB)
  const regexEspecial = /(?<![A-Za-z0-9–-])\b([CERH]\s*[-–]?\s*\d{4}\s*[-–]?\s*[A-Z]{1,3})(?![-–]?[A-Za-z0-9])/gi;
  let match: RegExpExecArray | null;
  while ((match = regexEspecial.exec(str)) !== null) {
    const rawMatch = match[1];
    const norm = normalizarMatricula(rawMatch);
    if (norm.estadoValidacion === 'VALIDA' && !normalizadosVistos.has(norm.matriculaNormalizada)) {
      candidatosEncontrados.push(rawMatch);
      normalizadosVistos.add(norm.matriculaNormalizada);
    }
  }

  // Patrón 2: Formato Oficial Fuerzas (PGC, CNP, etc.)
  const regexFuerzas = /(?<![A-Za-z0-9–-])\b((?:PGC|CNP|ET|EA|FN|CME|DGP|PMM|PME|MF|MMA)\s*[-–]?\s*\d{3,6}\s*[-–]?[A-Z]?)(?![-–]?[A-Za-z0-9])/gi;
  while ((match = regexFuerzas.exec(str)) !== null) {
    const rawMatch = match[1];
    const norm = normalizarMatricula(rawMatch);
    if (norm.estadoValidacion === 'VALIDA' && !normalizadosVistos.has(norm.matriculaNormalizada)) {
      candidatosEncontrados.push(rawMatch);
      normalizadosVistos.add(norm.matriculaNormalizada);
    }
  }

  // Patrón 3: Formato Moderno DGT (4 dígitos + 3 consonantes oficiales)
  // Ej: 1234 BBB, 1234-BBB, 1234BBB (con lookbehind para no capturar el sufijo de C-1234-BBB)
  const regexModerno = /(?<![A-Za-z0-9–-])\b(\d{4}\s*[-–]?\s*[BCDFGHJKLMNPRSTVWXYZ]{3})(?![-–]?[A-Za-z0-9])/gi;
  while ((match = regexModerno.exec(str)) !== null) {
    const rawMatch = match[1];
    const norm = normalizarMatricula(rawMatch);
    if (norm.estadoValidacion === 'VALIDA' && !normalizadosVistos.has(norm.matriculaNormalizada)) {
      candidatosEncontrados.push(rawMatch);
      normalizadosVistos.add(norm.matriculaNormalizada);
    }
  }

  // Patrón 4: Formato Provincial Alfanumérico (ej: M-1234-AB, SE 5678 CD)
  const regexProvAlfa = /(?<![A-Za-z0-9–-])\b((?:A|AB|AL|AV|B|BA|BI|BU|C|CA|CC|CS|CR|CO|CU|GE|GI|GR|GU|H|HU|J|L|LE|LO|LU|M|MA|ML|MU|NA|O|OR|OU|P|PM|IB|PO|S|SA|SE|SG|SO|SS|T|TE|TF|TO|V|VA|VI|Z|ZA|CE)\s*[-–]?\s*\d{4}\s*[-–]?\s*[A-Z]{1,2})(?![-–]?[A-Za-z0-9])/gi;
  while ((match = regexProvAlfa.exec(str)) !== null) {
    const rawMatch = match[1];
    const norm = normalizarMatricula(rawMatch);
    if (norm.estadoValidacion === 'VALIDA' && !normalizadosVistos.has(norm.matriculaNormalizada)) {
      candidatosEncontrados.push(rawMatch);
      normalizadosVistos.add(norm.matriculaNormalizada);
    }
  }

  // Patrón 5: Formato Provincial Numérico Antiguo (ej: M-123456, B 98765)
  // Lookahead negativo para no cortar una matrícula provincial alfanumérica (ej. M-9999 de M-9999-ZZ)
  const regexProvNum = /(?<![A-Za-z0-9–-])\b((?:A|AB|AL|AV|B|BA|BI|BU|C|CA|CC|CS|CR|CO|CU|GE|GI|GR|GU|H|HU|J|L|LE|LO|LU|M|MA|ML|MU|NA|O|OR|OU|P|PM|IB|PO|S|SA|SE|SG|SO|SS|T|TE|TF|TO|V|VA|VI|Z|ZA|CE)\s*[-–]?\s*\d{1,6})(?![-–]?[A-Za-z0-9])/gi;
  while ((match = regexProvNum.exec(str)) !== null) {
    const rawMatch = match[1];
    const norm = normalizarMatricula(rawMatch);
    if (norm.estadoValidacion === 'VALIDA' && !normalizadosVistos.has(norm.matriculaNormalizada)) {
      candidatosEncontrados.push(rawMatch);
      normalizadosVistos.add(norm.matriculaNormalizada);
    }
  }

  return candidatosEncontrados;
};

/**
 * Limpia y normaliza el texto bruto proveniente de una lectura óptica (Cámara / OCR).
 * Elimina saltos de línea, separadores gráficos, caracteres parásitos y diacríticos.
 */
export const limpiarTextoLecturaOCR = (raw: string): string => {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\\N|\\R|\\T/gi, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    // Símbolos de ruido de placa y artefactos de OCR (viñetas, puntos medios, corchetes, comillas, etc.)
    .replace(/[·•*°ºª()\[\]{}<>'\":;.,_\/\\\\|~^#$%&+=?!–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Función canónica ÚNICA de normalización para entradas procedentes de CÁMARA y OCR.
 *
 * Contempla taxativamente:
 * - Espacios (múltiples, interiores o ausentes)
 * - Guiones, barras, puntos y saltos de línea
 * - Mayúsculas / minúsculas
 * - Ruido gráfico de la placa: Banda azul europea ('E', 'ES', '[E]'), distintivo 'SP' (Servicio Público)
 * - Textos de portamatrículas / concesionarios ('GES', 'MOTOR', etc.)
 * - Desambiguación determinista entre turismo moderno con eurobanda ('E 1508 GSZ' -> '1508GSZ')
 *   y vehículo especial genuino ('E1508GSZ' preservado como clave alternativa para comprobación).
 * - Comparación canónica sin alterar el dato almacenado en la base de datos.
 */
export const normalizarMatriculaEntradaCamara = (
  raw: string | number | null | undefined
): MatriculaNormalizadaResultado => {
  if (raw === null || raw === undefined) {
    return normalizarMatricula('');
  }

  const str = String(raw).trim();
  const limpio = limpiarTextoLecturaOCR(str);
  if (!limpio) {
    return normalizarMatricula('');
  }

  // 1. Evaluación directa si la cadena limpia ya es una matrícula oficial española válida
  const normDirecta = normalizarMatricula(limpio);
  if (normDirecta.estadoValidacion === 'VALIDA') {
    // Si coincide con formato ESPECIAL que empieza por E, pero también encaja con formato MODERNO DGT:
    // (Ej: 'E 1508 GSZ' o 'E1508GSZ' capturada por cámara en un turismo donde la E es la banda europea)
    if (normDirecta.matriculaNormalizada.startsWith('E')) {
      const posibleSinE = normDirecta.matriculaNormalizada.slice(1);
      if (/^\d{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(posibleSinE)) {
        const normModerno = normalizarMatricula(posibleSinE);
        return {
          ...normModerno,
          matriculaOriginal: str,
          valorLimpio: posibleSinE.slice(0, 4) + ' ' + posibleSinE.slice(4),
          clavesCandidatasAlternativas: [normDirecta.matriculaNormalizada],
        };
      }
    }
    return normDirecta;
  }

  // 2. Eliminación de distintivos de país o servicio público ubicados en los extremos (separados por espacio o símbolos)
  const sinDistintivos = limpio
    .replace(/^(?:ES|SP)\s+/g, '')
    .replace(/\s+(?:ES|SP)$/g, '')
    .replace(/^E\s+/g, '')
    .replace(/\s+E$/g, '')
    .trim();

  const normSinDist = normalizarMatricula(sinDistintivos);
  if (normSinDist.estadoValidacion === 'VALIDA') {
    if (normSinDist.matriculaNormalizada.startsWith('E')) {
      const posibleSinE = normSinDist.matriculaNormalizada.slice(1);
      if (/^\d{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(posibleSinE)) {
        const normModerno = normalizarMatricula(posibleSinE);
        return {
          ...normModerno,
          matriculaOriginal: str,
          valorLimpio: posibleSinE.slice(0, 4) + ' ' + posibleSinE.slice(4),
          clavesCandidatasAlternativas: [normSinDist.matriculaNormalizada],
        };
      }
    }
    return {
      ...normSinDist,
      matriculaOriginal: str,
    };
  }

  // 3. Extracción robusta de patrones de matrícula oficial española dentro de texto con ruido circundante
  // (por ejemplo marcas, nombres de concesionarios 'GES', publicidad de portamatrículas)

  // Patrón 3.1: Formato Nacional Moderno Español (4 dígitos + 3 consonantes DGT)
  // Ej: 'GETAFE MOTOR 1508 GSZ' o '1508 GSZ GES'
  const matchMod = sinDistintivos.match(/\b(\d{4})\s*([BCDFGHJKLMNPRSTVWXYZ]{3})\b/);
  if (matchMod) {
    const can = matchMod[1] + matchMod[2];
    const norm = normalizarMatricula(can);
    if (norm.estadoValidacion === 'VALIDA') {
      return {
        ...norm,
        matriculaOriginal: str,
      };
    }
  }

  // Si no tenía espacio y estaba precedido por 'E' de la eurobanda (ej: 'E1508GSZ'):
  const matchModConE = sinDistintivos.match(/\bE(\d{4})([BCDFGHJKLMNPRSTVWXYZ]{3})\b/);
  if (matchModConE) {
    const can = matchModConE[1] + matchModConE[2];
    const norm = normalizarMatricula(can);
    if (norm.estadoValidacion === 'VALIDA') {
      return {
        ...norm,
        matriculaOriginal: str,
        clavesCandidatasAlternativas: ['E' + can],
      };
    }
  }

  // Patrón 3.2: Oficial Fuerzas y Cuerpos de Seguridad / Estado (PGC, CNP, etc.)
  const matchFuerzas = sinDistintivos.match(
    /\b(PGC|CNP|ET|EA|FN|CME|DGP|PMM|PME|MF|MMA)\s*(\d{3,6}\s*[A-Z]?)\b/
  );
  if (matchFuerzas) {
    const can = matchFuerzas[1] + matchFuerzas[2].replace(/\s+/g, '');
    const norm = normalizarMatricula(can);
    if (norm.estadoValidacion === 'VALIDA') {
      return {
        ...norm,
        matriculaOriginal: str,
      };
    }
  }

  // Patrón 3.3: Formato Provincial Alfanumérico (1-2 letras provinciales + 4 dígitos + 1-2 letras)
  const matchProvAlfa = sinDistintivos.match(/\b([A-Z]{1,2})\s*(\d{4})\s*([A-Z]{1,2})\b/);
  if (matchProvAlfa && PREFIJOS_PROVINCIALES_ESP.has(matchProvAlfa[1])) {
    const can = matchProvAlfa[1] + matchProvAlfa[2] + matchProvAlfa[3];
    const norm = normalizarMatricula(can);
    if (norm.estadoValidacion === 'VALIDA') {
      return {
        ...norm,
        matriculaOriginal: str,
      };
    }
  }

  // 3.4 Estabilización y auto-reparación sintáctica OCR para placas nacionales modernas
  // (se evalúa antes de provincial numérico para evitar falsos positivos con prefijo 'O' de Asturias en cadenas tipo 'O508 GSZ')
  const reparados = generarVariantesReparacionSintacticaOCR(sinDistintivos);
  for (const cand of reparados) {
    const normCand = normalizarMatricula(cand);
    if (normCand.estadoValidacion === 'VALIDA') {
      return {
        ...normCand,
        matriculaOriginal: str,
        incidencias: [
          ...(normSinDist.incidencias || []),
          'Estabilización sintáctica OCR aplicada (DGT 4 dígitos + 3 consonantes)',
        ],
        clavesCandidatasAlternativas: [
          normSinDist.matriculaNormalizada,
          ...reparados.filter((c) => c !== cand),
        ].filter(Boolean),
      };
    }
  }

  // Patrón 3.5: Formato Provincial Numérico Antiguo (1-2 letras provinciales + 1 a 6 dígitos sin letras posteriores)
  const matchProvNum = sinDistintivos.match(/\b([A-Z]{1,2})\s*(\d{1,6})\b(?!\s*[A-Z])/);
  if (matchProvNum && PREFIJOS_PROVINCIALES_ESP.has(matchProvNum[1])) {
    const can = matchProvNum[1] + matchProvNum[2];
    const norm = normalizarMatricula(can);
    if (norm.estadoValidacion === 'VALIDA') {
      return {
        ...norm,
        matriculaOriginal: str,
      };
    }
  }

  // Patrón 3.6: Formato Especial / Ciclomotor / Remolque (C, R, H + 4 dígitos + 1-3 letras)
  const matchEsp = sinDistintivos.match(/\b([CERH])\s*(\d{4})\s*([A-Z]{1,3})\b/);
  if (matchEsp) {
    const can = matchEsp[1] + matchEsp[2] + matchEsp[3];
    const norm = normalizarMatricula(can);
    if (norm.estadoValidacion === 'VALIDA') {
      return {
        ...norm,
        matriculaOriginal: str,
      };
    }
  }

  // Fallback: retornar resultado normalizado estándar con candidatos si existen
  if (reparados.length > 0) {
    return {
      ...normSinDist,
      clavesCandidatasAlternativas: reparados,
    };
  }

  return normSinDist;
};

const OCR_DIGIT_MAP: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  E: '3',
  A: '4',
  S: '5',
  G: '6',
  B: '8',
  T: '7',
  g: '9',
  q: '9',
};

const OCR_CONSONANT_MAP: Record<string, string> = {
  '0': 'D',
  '1': 'L',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
};

/**
 * Genera variantes candidatas corregidas sintácticamente según el formato DGT (4 dígitos + 3 consonantes).
 */
export const generarVariantesReparacionSintacticaOCR = (raw: string): string[] => {
  if (!raw) return [];
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const candidates = new Set<string>();

  const variants = [clean];
  if (clean.startsWith('E') && clean.length === 8) {
    variants.push(clean.slice(1));
  }

  for (const v of variants) {
    if (v.length === 7) {
      const dPart = v.slice(0, 4);
      const lPart = v.slice(4);

      let repairedD = '';
      for (const ch of dPart) {
        if (/\d/.test(ch)) repairedD += ch;
        else if (OCR_DIGIT_MAP[ch]) repairedD += OCR_DIGIT_MAP[ch];
        else repairedD += ch;
      }

      let repairedL = '';
      for (const ch of lPart) {
        if (/[BCDFGHJKLMNPRSTVWXYZ]/.test(ch)) repairedL += ch;
        else if (OCR_CONSONANT_MAP[ch]) repairedL += OCR_CONSONANT_MAP[ch];
        else repairedL += ch;
      }

      const combined = repairedD + repairedL;
      if (/^\d{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(combined)) {
        candidates.add(combined);
      }
    }
  }

  return Array.from(candidates);
};

