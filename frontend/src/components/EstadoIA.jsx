import { ESTADOS_IA } from '../utils/formato.js';

export default function EstadoIA({ fuente }) {
  const estado = ESTADOS_IA[fuente.estado_ia] || ESTADOS_IA.pendiente;
  const trabajando = ['pendiente', 'procesando'].includes(fuente.estado_ia);
  return (
    <span className={`estado-ia ${estado.clase}`} title={fuente.error_ia || ''}>
      {trabajando && <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />}
      {estado.texto}
    </span>
  );
}
