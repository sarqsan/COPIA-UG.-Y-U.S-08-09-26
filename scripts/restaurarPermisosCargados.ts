import { db } from '../src/firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { desglosarPeriodoPermisoUS, expandirRangoFechas } from '../src/services/festivosUSService';
import { SolicitudAusenciaUS, TipoAusenciaUS } from '../src/types/usTypes';
import { sanitizeForFirestore } from '../src/utils/firestoreSanitizer';

interface PermisoDef {
  id: string;
  personaId: string;
  personaNombre: string;
  tipoAusencia: TipoAusenciaUS;
  fechaInicio: string;
  fechaFin: string;
  motivo: string;
  fechaSolicitud: string;
}

const permisosOriginales: PermisoDef[] = [
  {
    id: 'sol-aus-us-1790068917382-excel',
    personaId: 'excel-us-rol2-10-wirw',
    personaNombre: 'SOLIVELLA',
    tipoAusencia: 'PERMISO',
    fechaInicio: '2026-11-02',
    fechaFin: '2026-11-19',
    motivo: 'Asignación oficial de PERMISO',
    fechaSolicitud: '2026-09-22T12:45:00.000Z',
  },
  {
    id: 'sol-aus-us-1790081563318-excel',
    personaId: 'excel-us-rol1-4-wirw',
    personaNombre: 'SANTIAGO',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-02',
    fechaFin: '2026-11-20',
    motivo: 'Asignación oficial de VACACIONES',
    fechaSolicitud: '2026-09-22T12:50:00.000Z',
  },
  {
    id: 'sol-aus-us-1790081631143-excel',
    personaId: 'excel-us-rol1-4-wirw',
    personaNombre: 'SANTIAGO',
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2026-11-23',
    fechaFin: '2026-11-30',
    motivo: 'Asignación oficial de ASUNTOS PROPIOS',
    fechaSolicitud: '2026-09-22T12:53:00.000Z',
  },
  {
    id: 'sol-aus-us-1790083225908-excel',
    personaId: 'excel-us-rol1-16-wirx',
    personaNombre: 'ORDOÑEZ',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-02',
    motivo: 'Asignación oficial de VACACIONES',
    fechaSolicitud: '2026-09-22T13:20:00.000Z',
  },
  {
    id: 'sol-aus-us-1790159449490-excel',
    personaId: 'excel-us-rol2-12-wirx',
    personaNombre: 'ARAGON',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-18',
    motivo: 'Asignación oficial de VACACIONES',
    fechaSolicitud: '2026-09-23T10:30:00.000Z',
  },
  {
    id: 'sol-aus-us-1790159490002-excel',
    personaId: 'excel-us-rol2-12-wirx',
    personaNombre: 'ARAGON',
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2026-11-19',
    fechaFin: '2026-11-27',
    motivo: 'Asignación oficial de ASUNTOS PROPIOS',
    fechaSolicitud: '2026-09-23T10:31:00.000Z',
  },
  {
    id: 'sol-aus-us-1790588125196-excel',
    personaId: 'excel-us-rol1-1-wirw',
    personaNombre: 'ARACIL',
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-11',
    motivo: 'Asignación oficial de ASUNTOS PROPIOS',
    fechaSolicitud: '2026-09-28T09:35:00.000Z',
  },
  {
    id: 'sol-aus-us-1790588157388-excel',
    personaId: 'excel-us-rol1-1-wirw',
    personaNombre: 'ARACIL',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-18',
    fechaFin: '2026-12-02',
    motivo: 'Asignación oficial de VACACIONES',
    fechaSolicitud: '2026-09-28T09:35:30.000Z',
  },
  {
    id: 'sol-aus-us-1790759511951-excel',
    personaId: 'excel-us-rol2-12-wirx',
    personaNombre: 'ARAGON',
    tipoAusencia: 'PERMISO',
    fechaInicio: '2026-11-30',
    fechaFin: '2027-01-29',
    motivo: 'Asignación oficial de PERMISO',
    fechaSolicitud: '2026-09-30T09:11:00.000Z',
  },
  {
    id: 'sol-aus-us-1790759671212-excel',
    personaId: 'excel-us-rol2-13-wirx',
    personaNombre: 'CHARCOS',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-16',
    fechaFin: '2026-11-27',
    motivo: 'Asignación oficial de VACACIONES',
    fechaSolicitud: '2026-09-30T09:14:00.000Z',
  },
];

async function main() {
  console.log('Restaurando los permisos cargados del usuario...');

  for (const item of permisosOriginales) {
    const fechasAfectadas = expandirRangoFechas(item.fechaInicio, item.fechaFin);
    const desglose = desglosarPeriodoPermisoUS(fechasAfectadas, item.tipoAusencia);

    const solicitud: SolicitudAusenciaUS = {
      id: item.id,
      personaId: item.personaId,
      personaNombre: item.personaNombre,
      tipoAusencia: item.tipoAusencia,
      fechaInicio: item.fechaInicio,
      fechaFin: item.fechaFin,
      fechasAfectadas,
      diasConsumibles: desglose.totalDiasConsumibles,
      diasTotales: desglose.totalDiasSolicitados,
      diasNoConsumibles: desglose.totalDiasNoConsumibles,
      festivosExcluidos: desglose.fechasFestivas,
      finesSemanaExcluidos: desglose.fechasFinesSemana,
      motivo: item.motivo,
      estado: 'APROBADA',
      fechaSolicitud: item.fechaSolicitud,
      fechaResolucion: item.fechaSolicitud,
      adminResolucionNombre: 'Administrador Oficial',
    };

    const docRef = doc(db, 'ausencias_us', item.id);
    await setDoc(docRef, sanitizeForFirestore(solicitud), { merge: true });
    console.log(`✅ Restaurado permiso ${item.id} para ${item.personaNombre} (${item.tipoAusencia} ${item.fechaInicio} a ${item.fechaFin})`);
  }

  console.log('\nTodos los permisos cargados han sido restaurados con éxito.');
  process.exit(0);
}

main().catch(err => {
  console.error('Error restaurando permisos:', err);
  process.exit(1);
});
