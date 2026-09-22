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

  // esLaborable: Lunes a Viernes no festivo ni día especial
  const esLaborable = diaSemana >= 1 && diaSemana <= 5 && !esDiaEspecial && !esFestivo;

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
