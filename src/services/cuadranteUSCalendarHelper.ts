import { DiaEspecialConfig } from '../types';
import { getDiaEspecialConfig } from './diasEspecialesService';
import { esFestivoUS } from './festivosUSService';

export interface InfoDiaUS {
  fecha: string;
  diaSemana: number; // 0=Domingo, 1=Lunes, ..., 6=Sábado
  esSabado: boolean;
  esDomingo: boolean;
  esFinDeSemana: boolean;
  esFestivo: boolean;
  esDiaEspecial: boolean;
  diaEspecialConfig: DiaEspecialConfig | null;
  puntosEspeciales: number;
  tipoPrincipal: 'LABORABLE' | 'SABADO' | 'DOMINGO' | 'FESTIVO' | 'DIA_ESPECIAL';
  esLaborable: boolean;
  esNocturnoProlongado: boolean;
}

export const clasificarDiaUS = (fechaStr: string, fechaMananaStr?: string): InfoDiaUS => {
  const d = new Date(fechaStr + 'T12:00:00Z');
  const diaSemana = d.getUTCDay();
  const esSabado = diaSemana === 6;
  const esDomingo = diaSemana === 0;
  const esFinDeSemana = esSabado || esDomingo;

  const config = getDiaEspecialConfig(fechaStr);
  const tieneConfig = !!config && config.activo;
  const puntos = tieneConfig ? config.puntos : 0;
  const esFestivo = esFestivoUS(fechaStr);
  const esDiaEspecial = tieneConfig && (config.categoria === 'NAVIDAD' || config.categoria === 'FAMILIAR') && !esFestivo;

  // esLaborable: Lunes a Viernes no festivo (los días especiales de rotación como 24 Dic, 31 Dic o 5 Ene son laborables y computan 7.5h)
  const esLaborable = diaSemana >= 1 && diaSemana <= 5 && !esFestivo;

  // tipoPrincipal (prioridad normativa)
  let tipoPrincipal: 'LABORABLE' | 'SABADO' | 'DOMINGO' | 'FESTIVO' | 'DIA_ESPECIAL' = 'LABORABLE';
  if (esFestivo) {
    tipoPrincipal = 'FESTIVO';
  } else if (esDiaEspecial) {
    tipoPrincipal = 'DIA_ESPECIAL';
  } else if (esSabado) {
    tipoPrincipal = 'SABADO';
  } else if (esDomingo) {
    tipoPrincipal = 'DOMINGO';
  } else {
    tipoPrincipal = 'LABORABLE';
  }

  // Prolongación nocturna: sólo si el día siguiente es laborable
  let esNocturnoProlongado = false;
  if (fechaMananaStr) {
    const manana = clasificarDiaUS(fechaMananaStr);
    esNocturnoProlongado = manana.esLaborable;
  }

  return {
    fecha: fechaStr,
    diaSemana,
    esSabado,
    esDomingo,
    esFinDeSemana,
    esFestivo,
    esDiaEspecial,
    diaEspecialConfig: config,
    puntosEspeciales: puntos,
    tipoPrincipal,
    esLaborable,
    esNocturnoProlongado,
  };
};

/**
 * Calcula el descuento oficial de horas U.S. para un periodo:
 * - Regla base: 15 horas de descuento por mes completo.
 * - Para periodos extendidos o irregulares (ej. 1 mes y 1 semana = 38 días, de 1 Dic a 7 Ene):
 *   1 mes (15h) + 1 semana (3.5h) = 18.5 horas exactas.
 * - Proporcionalidad general: (totalDias / 30.5) * 15h, redondeado a múltiplos de 0.5h.
 */
export const calcularAjusteHorasPeriodoUS = (
  inicioOtotalDias: string | number,
  fechaFinStr?: string,
  tasaMensual: number = 15
): number => {
  let totalDias = 30;
  if (typeof inicioOtotalDias === 'number') {
    totalDias = Math.max(1, inicioOtotalDias);
  } else if (inicioOtotalDias && fechaFinStr) {
    const d1 = new Date(inicioOtotalDias + 'T12:00:00Z');
    const d2 = new Date(fechaFinStr + 'T12:00:00Z');
    const diff = d2.getTime() - d1.getTime();
    totalDias = Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
  }

  // 1 mes estándar (28 a 31 días)
  if (totalDias >= 28 && totalDias <= 31) {
    return tasaMensual;
  }

  // 1 mes y 1 semana exactos (38 días, ej. 1 Dic a 7 Ene): 15h + 3.5h = 18.5h
  if (totalDias === 38) {
    return 18.5;
  }

  // Proporción mensual general escalada a 0.5h
  const proporcion = (totalDias / 30.5) * tasaMensual;
  return Math.round(proporcion * 2) / 2;
};

