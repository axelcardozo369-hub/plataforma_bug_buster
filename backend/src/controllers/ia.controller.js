import { estadoIA } from '../services/ia/index.js';

// GET /api/ia/estado — el frontend lo usa para avisar si la IA está disponible
export const getEstadoIA = (req, res) => {
  try {
    return res.status(200).json(estadoIA());
  } catch (error) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
};
