import {
  ServicioDia,
  DiferenciaCuadrante,
  ResultadoComparacionCuadrante,
  Persona,
} from '../types';

/**
 * Servicio preparado para contrastar el cuadrante generado contra un cuadrante real de ~6 meses.
 * Permite detectar divergencias, cambios manuales, permutas y calibrar el algoritmo en FASE 2C.
 */
export const compararCuadrantes = (params: {
  serviciosReales: {
    fecha: string;
    rol1_1Nombre: string;
    rol1_2Nombre: string;
    rol2_1Nombre: string;
    rol2_2Nombre: string;
    rol1ImagNombre: string;
    rol2ImagNombre: string;
  }[];
  serviciosGenerados: ServicioDia[];
  personas: Persona[];
}): ResultadoComparacionCuadrante => {
  const { serviciosReales, serviciosGenerados, personas } = params;
  const personasMap = new Map<string, Persona>();
  personas.forEach((p) => personasMap.set(p.id, p));

  const generadosPorFecha = new Map<string, ServicioDia>();
  serviciosGenerados.forEach((s) => generadosPorFecha.set(s.fecha, s));

  const diferencias: DiferenciaCuadrante[] = [];
  let totalPuestos = 0;
  let coincidencias = 0;

  serviciosReales.forEach((real) => {
    const gen = generadosPorFecha.get(real.fecha);
    if (!gen) return;

    const puestosAComparar: {
      tipo: DiferenciaCuadrante['tipoPuesto'];
      nombreReal: string;
      idGen: string;
    }[] = [
      {
        tipo: 'ROL1_TITULAR_1',
        nombreReal: real.rol1_1Nombre,
        idGen: gen.titulares.rol1[0]?.personaIdReal,
      },
      {
        tipo: 'ROL1_TITULAR_2',
        nombreReal: real.rol1_2Nombre,
        idGen: gen.titulares.rol1[1]?.personaIdReal,
      },
      {
        tipo: 'ROL2_TITULAR_1',
        nombreReal: real.rol2_1Nombre,
        idGen: gen.titulares.rol2[0]?.personaIdReal,
      },
      {
        tipo: 'ROL2_TITULAR_2',
        nombreReal: real.rol2_2Nombre,
        idGen: gen.titulares.rol2[1]?.personaIdReal,
      },
      {
        tipo: 'ROL1_IMAGINARIA',
        nombreReal: real.rol1ImagNombre,
        idGen: gen.imaginarias.rol1?.personaIdReal,
      },
      {
        tipo: 'ROL2_IMAGINARIA',
        nombreReal: real.rol2ImagNombre,
        idGen: gen.imaginarias.rol2?.personaIdReal,
      },
    ];

    puestosAComparar.forEach((p) => {
      totalPuestos++;
      const pGen = personasMap.get(p.idGen);
      const nombreGen = pGen ? pGen.nombre : '';

      // Comparación normalizada
      const normalizar = (s: string) =>
        s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      const coincide = normalizar(p.nombreReal) === normalizar(nombreGen);

      if (coincide) {
        coincidencias++;
      } else {
        diferencias.push({
          fecha: real.fecha,
          tipoPuesto: p.tipo,
          personaRealNombre: p.nombreReal,
          personaGeneradaId: p.idGen,
          personaGeneradaNombre: nombreGen,
          coincide: false,
        });
      }
    });
  });

  const porcentaje =
    totalPuestos > 0
      ? Number(((coincidencias / totalPuestos) * 100).toFixed(1))
      : 0;

  return {
    totalDiasAnalizados: serviciosReales.length,
    totalPuestosEvaluados: totalPuestos,
    coincidenciasExactas: coincidencias,
    porcentajeFidelidad: porcentaje,
    diferencias,
    analisisCausas: {
      diferenciasPorOrdenInicial: 0,
      diferenciasPorImaginarias: 0,
      ajustesManualesDetectados: 0,
    },
  };
};

/**
 * Fotografía atómica diaria de asignaciones de ROL 1 para verificar su preservación absoluta (R1_ANTES = R1_DESPUÉS)
 */
export interface FotografiaRol1Dia {
  fecha: string;
  titular1Original: string;
  titular1Real: string;
  titular1Estado: string;
  titular1Origen: string;
  titular2Original: string;
  titular2Real: string;
  titular2Estado: string;
  titular2Origen: string;
  imaginariaOriginal: string;
  imaginariaReal: string;
  imaginariaEstado: string;
  imaginariaOrigen: string;
}

export interface CambioRol1Detectado {
  fecha: string;
  puesto: 'TITULAR_1' | 'TITULAR_2' | 'IMAGINARIA';
  campo: string;
  antes: string;
  despues: string;
}

export interface ComparacionRol1Result {
  esIdentico: boolean;
  totalDias: number;
  diasConCambios: number;
  totalCambiosDetectados: number;
  cambios: CambioRol1Detectado[];
}

/**
 * Extrae la fotografía estructurada de asignaciones de ROL 1 (R1_ANTES o R1_DESPUÉS)
 */
export const extraerFotografiaRol1 = (servicios: ServicioDia[]): FotografiaRol1Dia[] => {
  return servicios.map((srv) => ({
    fecha: srv.fecha,
    titular1Original: srv.titulares?.rol1?.[0]?.personaIdOriginal || '',
    titular1Real: srv.titulares?.rol1?.[0]?.personaIdReal || '',
    titular1Estado: srv.titulares?.rol1?.[0]?.estadoAsignacion || '',
    titular1Origen: srv.titulares?.rol1?.[0]?.tipoOrigen || '',
    titular2Original: srv.titulares?.rol1?.[1]?.personaIdOriginal || '',
    titular2Real: srv.titulares?.rol1?.[1]?.personaIdReal || '',
    titular2Estado: srv.titulares?.rol1?.[1]?.estadoAsignacion || '',
    titular2Origen: srv.titulares?.rol1?.[1]?.tipoOrigen || '',
    imaginariaOriginal: srv.imaginarias?.rol1?.personaIdOriginal || '',
    imaginariaReal: srv.imaginarias?.rol1?.personaIdReal || '',
    imaginariaEstado: srv.imaginarias?.rol1?.estadoAsignacion || '',
    imaginariaOrigen: srv.imaginarias?.rol1?.tipoOrigen || '',
  }));
};

/**
 * Compara dos fotografías de R1 día a día y puesto por puesto.
 * Garantiza la regla: R1_ANTES = R1_DESPUÉS.
 */
export const compararFotografiasRol1 = (
  antes: FotografiaRol1Dia[],
  despues: FotografiaRol1Dia[]
): ComparacionRol1Result => {
  const mapDespues = new Map<string, FotografiaRol1Dia>();
  despues.forEach((f) => mapDespues.set(f.fecha, f));

  const cambios: CambioRol1Detectado[] = [];
  const diasAfectados = new Set<string>();

  antes.forEach((ant) => {
    const desp = mapDespues.get(ant.fecha);
    if (!desp) {
      cambios.push({
        fecha: ant.fecha,
        puesto: 'TITULAR_1',
        campo: 'fecha',
        antes: ant.fecha,
        despues: 'NO_EXISTE_EN_DESPUES',
      });
      diasAfectados.add(ant.fecha);
      return;
    }

    // Titular 1
    if (ant.titular1Original !== desp.titular1Original) {
      cambios.push({ fecha: ant.fecha, puesto: 'TITULAR_1', campo: 'personaIdOriginal', antes: ant.titular1Original, despues: desp.titular1Original });
      diasAfectados.add(ant.fecha);
    }
    if (ant.titular1Real !== desp.titular1Real) {
      cambios.push({ fecha: ant.fecha, puesto: 'TITULAR_1', campo: 'personaIdReal', antes: ant.titular1Real, despues: desp.titular1Real });
      diasAfectados.add(ant.fecha);
    }

    // Titular 2
    if (ant.titular2Original !== desp.titular2Original) {
      cambios.push({ fecha: ant.fecha, puesto: 'TITULAR_2', campo: 'personaIdOriginal', antes: ant.titular2Original, despues: desp.titular2Original });
      diasAfectados.add(ant.fecha);
    }
    if (ant.titular2Real !== desp.titular2Real) {
      cambios.push({ fecha: ant.fecha, puesto: 'TITULAR_2', campo: 'personaIdReal', antes: ant.titular2Real, despues: desp.titular2Real });
      diasAfectados.add(ant.fecha);
    }

    // Imaginaria
    if (ant.imaginariaOriginal !== desp.imaginariaOriginal) {
      cambios.push({ fecha: ant.fecha, puesto: 'IMAGINARIA', campo: 'personaIdOriginal', antes: ant.imaginariaOriginal, despues: desp.imaginariaOriginal });
      diasAfectados.add(ant.fecha);
    }
    if (ant.imaginariaReal !== desp.imaginariaReal) {
      cambios.push({ fecha: ant.fecha, puesto: 'IMAGINARIA', campo: 'personaIdReal', antes: ant.imaginariaReal, despues: desp.imaginariaReal });
      diasAfectados.add(ant.fecha);
    }
  });

  return {
    esIdentico: cambios.length === 0,
    totalDias: antes.length,
    diasConCambios: diasAfectados.size,
    totalCambiosDetectados: cambios.length,
    cambios,
  };
};

export interface ResumenComparacionConservacion {
  totalDias: number;
  r1Conservado: boolean;
  totalCambiosR1: number;
  totalCambiosR2Titulares: number;
  totalCambiosR2Imaginarias: number;
  detalleCambios: {
    fecha: string;
    puesto: string;
    antesPersonaId: string;
    despuesPersonaId: string;
    motivo?: string;
  }[];
}

/**
 * Compara dos versiones completas del cuadrante (Actual vs Propuesto) para validar la regla de conservación + ajuste mínimo
 */
export const compararConservacionCuadrante = (
  serviciosActuales: ServicioDia[],
  serviciosPropuestos: ServicioDia[]
): ResumenComparacionConservacion => {
  const r1Antes = extraerFotografiaRol1(serviciosActuales);
  const r1Despues = extraerFotografiaRol1(serviciosPropuestos);
  const compR1 = compararFotografiasRol1(r1Antes, r1Despues);

  const mapProp = new Map<string, ServicioDia>();
  serviciosPropuestos.forEach((s) => mapProp.set(s.fecha, s));

  let totalCambiosR2Titulares = 0;
  let totalCambiosR2Imaginarias = 0;
  const detalleCambios: ResumenComparacionConservacion['detalleCambios'] = [];

  serviciosActuales.forEach((act) => {
    const prop = mapProp.get(act.fecha);
    if (!prop) return;

    // R2 Titular 1
    const r2_1_act = act.titulares?.rol2?.[0]?.personaIdReal;
    const r2_1_prop = prop.titulares?.rol2?.[0]?.personaIdReal;
    if (r2_1_act !== r2_1_prop) {
      totalCambiosR2Titulares++;
      detalleCambios.push({
        fecha: act.fecha,
        puesto: 'ROL2_TITULAR_1',
        antesPersonaId: r2_1_act || '',
        despuesPersonaId: r2_1_prop || '',
        motivo: prop.titulares?.rol2?.[0]?.motivoCambio || 'Ajuste incremental ROL 2',
      });
    }

    // R2 Titular 2
    const r2_2_act = act.titulares?.rol2?.[1]?.personaIdReal;
    const r2_2_prop = prop.titulares?.rol2?.[1]?.personaIdReal;
    if (r2_2_act !== r2_2_prop) {
      totalCambiosR2Titulares++;
      detalleCambios.push({
        fecha: act.fecha,
        puesto: 'ROL2_TITULAR_2',
        antesPersonaId: r2_2_act || '',
        despuesPersonaId: r2_2_prop || '',
        motivo: prop.titulares?.rol2?.[1]?.motivoCambio || 'Ajuste incremental ROL 2',
      });
    }

    // R2 Imaginaria
    const r2_imag_act = act.imaginarias?.rol2?.personaIdReal;
    const r2_imag_prop = prop.imaginarias?.rol2?.personaIdReal;
    if (r2_imag_act !== r2_imag_prop) {
      totalCambiosR2Imaginarias++;
      detalleCambios.push({
        fecha: act.fecha,
        puesto: 'ROL2_IMAGINARIA',
        antesPersonaId: r2_imag_act || '',
        despuesPersonaId: r2_imag_prop || '',
        motivo: 'Ajuste rotación imaginaria ROL 2',
      });
    }
  });

  return {
    totalDias: serviciosActuales.length,
    r1Conservado: compR1.esIdentico,
    totalCambiosR1: compR1.totalCambiosDetectados,
    totalCambiosR2Titulares,
    totalCambiosR2Imaginarias,
    detalleCambios,
  };
};
