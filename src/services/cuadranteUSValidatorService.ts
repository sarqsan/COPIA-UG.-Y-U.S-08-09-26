import { ServicioDiaUS, MetricasCuadranteUS } from '../types/usTypes';
import { Persona, InformeValidacion, ValidacionItem } from '../types';

/**
 * Validador exhaustivo e independiente para cuadrantes de la U.S. (Unidad de Seguridad - 12h)
 */
export const validarCuadranteUS = (params: {
  servicios: ServicioDiaUS[];
  personas: Persona[];
  metricas?: MetricasCuadranteUS;
}): InformeValidacion => {
  const { servicios, personas } = params;
  const items: ValidacionItem[] = [];

  const personasMap = new Map<string, Persona>();
  personas.forEach((p) => personasMap.set(p.id, p));

  const mapaServiciosPorDia: Record<number, ServicioDiaUS> = {};
  servicios.forEach((s, idx) => {
    mapaServiciosPorDia[idx] = s;
  });

  // 1. Validaciones Día a Día
  servicios.forEach((s, diaIdx) => {
    const d1 = s.diurno?.titulares?.[0]?.personaIdReal;
    const d2 = s.diurno?.titulares?.[1]?.personaIdReal;
    const n1 = s.nocturno?.titulares?.[0]?.personaIdReal;
    const n2 = s.nocturno?.titulares?.[1]?.personaIdReal;
    const imag = s.imaginaria?.personaIdReal;

    // US-01: Cobertura Diurna (2 personas)
    if (!d1 || !d2) {
      items.push({
        codigo: 'US-01',
        severidad: 'ERROR',
        fecha: s.fecha,
        descripcion: `El turno Diurno (07:00 a 19:00) del día ${s.fecha} está incompleto (se requieren 2 efectivos).`,
      });
    }

    // US-02: Cobertura Nocturna (2 personas)
    if (!n1 || !n2) {
      items.push({
        codigo: 'US-02',
        severidad: 'ERROR',
        fecha: s.fecha,
        descripcion: `El turno Nocturno (19:00 a 07:00/07:45) del día ${s.fecha} está incompleto (se requieren 2 efectivos).`,
      });
    }

    // US-03: Cobertura Imaginaria (1 persona)
    if (!imag) {
      items.push({
        codigo: 'US-03',
        severidad: 'ERROR',
        fecha: s.fecha,
        descripcion: `Falta asignar la Imaginaria de 24h para el día ${s.fecha}.`,
      });
    }

    // Duplicados en Diurno
    if (d1 && d2 && d1 === d2) {
      items.push({
        codigo: 'US-05',
        severidad: 'ERROR',
        fecha: s.fecha,
        personaId: d1,
        personaNombre: personasMap.get(d1)?.nombre || d1,
        descripcion: `El usuario ${personasMap.get(d1)?.nombre || d1} está asignado por duplicado en el Turno Diurno del ${s.fecha}.`,
      });
    }

    // Duplicados en Nocturno
    if (n1 && n2 && n1 === n2) {
      items.push({
        codigo: 'US-05',
        severidad: 'ERROR',
        fecha: s.fecha,
        personaId: n1,
        personaNombre: personasMap.get(n1)?.nombre || n1,
        descripcion: `El usuario ${personasMap.get(n1)?.nombre || n1} está asignado por duplicado en el Turno Nocturno del ${s.fecha}.`,
      });
    }

    // US-04: Solapamiento Diurno y Nocturno el mismo día
    const diurnos = [d1, d2].filter(Boolean);
    const nocturnos = [n1, n2].filter(Boolean);
    diurnos.forEach((pId) => {
      if (nocturnos.includes(pId)) {
        items.push({
          codigo: 'US-04',
          severidad: 'ERROR',
          fecha: s.fecha,
          personaId: pId,
          personaNombre: personasMap.get(pId)?.nombre || pId,
          descripcion: `Conflicto de solapamiento: el usuario ${personasMap.get(pId)?.nombre || pId} tiene asignado turno Diurno y Nocturno el mismo día (${s.fecha}).`,
        });
      }
    });

    const serviciosHoy = [...diurnos, ...nocturnos];

    // US-06: RESTRICCIÓN IMAGINARIA - Mismo día
    if (imag && serviciosHoy.includes(imag)) {
      items.push({
        codigo: 'US-06',
        severidad: 'ERROR',
        fecha: s.fecha,
        personaId: imag,
        personaNombre: personasMap.get(imag)?.nombre || imag,
        descripcion: `Incompatibilidad de Imaginaria: ${personasMap.get(imag)?.nombre || imag} no puede ser imaginaria el mismo día que tiene servicio (${s.fecha}).`,
      });
    }

    // US-07: RESTRICCIÓN IMAGINARIA - Día anterior
    // Si la persona tiene servicio el día siguiente (diaIdx + 1), NO puede ser imaginaria hoy
    const diaSiguiente = mapaServiciosPorDia[diaIdx + 1];
    if (imag && diaSiguiente) {
      const dSig1 = diaSiguiente.diurno?.titulares?.[0]?.personaIdReal;
      const dSig2 = diaSiguiente.diurno?.titulares?.[1]?.personaIdReal;
      const nSig1 = diaSiguiente.nocturno?.titulares?.[0]?.personaIdReal;
      const nSig2 = diaSiguiente.nocturno?.titulares?.[1]?.personaIdReal;
      const serviciosManana = [dSig1, dSig2, nSig1, nSig2].filter(Boolean);

      if (serviciosManana.includes(imag)) {
        items.push({
          codigo: 'US-07',
          severidad: 'ERROR',
          fecha: s.fecha,
          personaId: imag,
          personaNombre: personasMap.get(imag)?.nombre || imag,
          descripcion: `Incompatibilidad de Imaginaria (Día Anterior): ${personasMap.get(imag)?.nombre || imag} es imaginaria el ${s.fecha} pero tiene servicio el día posterior (${diaSiguiente.fecha}).`,
        });
      }
    }

    // US-08: RESTRICCIÓN IMAGINARIA - Día posterior
    // Si la persona tuvo servicio el día anterior (diaIdx - 1), NO puede ser imaginaria hoy
    const diaAnterior = mapaServiciosPorDia[diaIdx - 1];
    if (imag && diaAnterior) {
      const dAnt1 = diaAnterior.diurno?.titulares?.[0]?.personaIdReal;
      const dAnt2 = diaAnterior.diurno?.titulares?.[1]?.personaIdReal;
      const nAnt1 = diaAnterior.nocturno?.titulares?.[0]?.personaIdReal;
      const nAnt2 = diaAnterior.nocturno?.titulares?.[1]?.personaIdReal;
      const serviciosAyer = [dAnt1, dAnt2, nAnt1, nAnt2].filter(Boolean);

      if (serviciosAyer.includes(imag)) {
        items.push({
          codigo: 'US-08',
          severidad: 'ERROR',
          fecha: s.fecha,
          personaId: imag,
          personaNombre: personasMap.get(imag)?.nombre || imag,
          descripcion: `Incompatibilidad de Imaginaria (Día Posterior): ${personasMap.get(imag)?.nombre || imag} es imaginaria el ${s.fecha} habiendo realizado servicio el día anterior (${diaAnterior.fecha}).`,
        });
      }
    }

    // US-09: DESCANSO OBLIGATORIO TRAS TURNO NOCTURNO
    // Quien hizo Noche en diaIdx-1 termina en diaIdx mañana. NO puede hacer Diurno ni Nocturno en diaIdx
    if (diaAnterior) {
      const nAnt1 = diaAnterior.nocturno?.titulares?.[0]?.personaIdReal;
      const nAnt2 = diaAnterior.nocturno?.titulares?.[1]?.personaIdReal;
      const salientesNoche = [nAnt1, nAnt2].filter(Boolean);

      salientesNoche.forEach((pId) => {
        if (serviciosHoy.includes(pId)) {
          items.push({
            codigo: 'US-09',
            severidad: 'ERROR',
            fecha: s.fecha,
            personaId: pId,
            personaNombre: personasMap.get(pId)?.nombre || pId,
            descripcion: `Incumplimiento de descanso obligatorio: ${personasMap.get(pId)?.nombre || pId} realizó turno nocturno el ${diaAnterior.fecha} y tiene servicio asignado el ${s.fecha} (saliente de noche sin descanso reglamentario).`,
          });
        }
      });
    }

    // US-10 & US-11: AUSENCIAS (V, P, AP)
    const ausenciasHoy = s.ausencias || [];
    if (ausenciasHoy.length > 4) {
      items.push({
        codigo: 'US-11',
        severidad: 'ERROR',
        fecha: s.fecha,
        descripcion: `Cupo máximo de ausencias superado el día ${s.fecha}: hay ${ausenciasHoy.length} personas con permiso/vacaciones (máximo permitido: 4).`,
      });
    }

    const idsConAusencia = new Set(ausenciasHoy.map((a) => a.personaId));
    serviciosHoy.forEach((pId) => {
      if (idsConAusencia.has(pId)) {
        items.push({
          codigo: 'US-10',
          severidad: 'ERROR',
          fecha: s.fecha,
          personaId: pId,
          personaNombre: personasMap.get(pId)?.nombre || pId,
          descripcion: `Incompatibilidad absoluta: ${personasMap.get(pId)?.nombre || pId} tiene vacaciones/permiso concedido el ${s.fecha} y tiene un servicio asignado ese día.`,
        });
      }
    });

    if (imag && idsConAusencia.has(imag)) {
      items.push({
        codigo: 'US-10',
        severidad: 'ERROR',
        fecha: s.fecha,
        personaId: imag,
        personaNombre: personasMap.get(imag)?.nombre || imag,
        descripcion: `Incompatibilidad absoluta: ${personasMap.get(imag)?.nombre || imag} tiene vacaciones/permiso el ${s.fecha} y no puede ser nombrado imaginaria.`,
      });
    }

    // US-13: PRESENTES
    (s.presentes || []).forEach((pr) => {
      const pId = pr.personaIdReal;
      if (serviciosHoy.includes(pId)) {
        items.push({
          codigo: 'US-13',
          severidad: 'ERROR',
          fecha: s.fecha,
          personaId: pId,
          personaNombre: personasMap.get(pId)?.nombre || pId,
          descripcion: `Incompatibilidad de Presente: ${personasMap.get(pId)?.nombre || pId} tiene servicio de 12h y presente asignado el mismo día (${s.fecha}).`,
        });
      }
      if (imag === pId) {
        items.push({
          codigo: 'US-13',
          severidad: 'ERROR',
          fecha: s.fecha,
          personaId: pId,
          personaNombre: personasMap.get(pId)?.nombre || pId,
          descripcion: `Incompatibilidad de Presente: ${personasMap.get(pId)?.nombre || pId} no puede ser presente e imaginaria simultáneamente el ${s.fecha}.`,
        });
      }
      if (idsConAusencia.has(pId)) {
        items.push({
          codigo: 'US-13',
          severidad: 'ERROR',
          fecha: s.fecha,
          personaId: pId,
          personaNombre: personasMap.get(pId)?.nombre || pId,
          descripcion: `Incompatibilidad de Presente: ${personasMap.get(pId)?.nombre || pId} tiene vacaciones/permiso el ${s.fecha} y no puede estar asignado como presente.`,
        });
      }
      if (!s.esLaborable) {
        items.push({
          codigo: 'US-12',
          severidad: 'ADVERTENCIA',
          fecha: s.fecha,
          personaId: pId,
          personaNombre: personasMap.get(pId)?.nombre || pId,
          descripcion: `Presente asignado en día no laborable / fin de semana (${s.fecha}).`,
        });
      }
    });
  });

  // 2. Validaciones Globales de Equilibrio (Advertencias si procede)
  if (params.metricas) {
    const met = params.metricas;
    if (met.diferenciaServicios > 4) {
      items.push({
        codigo: 'US-14',
        severidad: 'ADVERTENCIA',
        descripcion: `Desviación en reparto de servicios: la diferencia máxima de servicios entre efectivos es de ${met.diferenciaServicios}.`,
      });
    }
    if (met.diferenciaNocturnos > 3) {
      items.push({
        codigo: 'US-15',
        severidad: 'ADVERTENCIA',
        descripcion: `Desviación en turnos nocturnos: la diferencia máxima de noches entre efectivos es de ${met.diferenciaNocturnos}.`,
      });
    }
    if (met.diferenciaFinesSemana > 3) {
      items.push({
        codigo: 'US-16',
        severidad: 'ADVERTENCIA',
        descripcion: `Desviación en fines de semana: la diferencia máxima en sábados/domingos es de ${met.diferenciaFinesSemana}.`,
      });
    }
  }

  const totalErrores = items.filter((i) => i.severidad === 'ERROR').length;
  const totalAdvertencias = items.filter((i) => i.severidad === 'ADVERTENCIA').length;

  return {
    valido: totalErrores === 0,
    totalErrores,
    totalAdvertencias,
    items,
  };
};
