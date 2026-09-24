import { env } from '../../config/env.js';
import { crearProveedorGemini } from './gemini.proveedor.js';
import { crearProveedorOpenRouter } from './openrouter.proveedor.js';
import { crearProveedorSimulado } from './simulado.proveedor.js';

function esFalloTransitorio(error) {
  return [408, 429, 500, 502, 503, 504].includes(error?.status);
}

function crearProveedor() {
  const gemini = env.GEMINI_API_KEY
    ? crearProveedorGemini({ apiKey: env.GEMINI_API_KEY, modelo: env.GEMINI_MODEL, baseUrl: env.GEMINI_BASE_URL })
    : null;
  const openrouter = env.OPENROUTER_API_KEY
    ? crearProveedorOpenRouter({
        apiKey: env.OPENROUTER_API_KEY,
        modelo: env.OPENROUTER_MODEL,
        siteUrl: env.OPENROUTER_SITE_URL,
        siteName: env.OPENROUTER_SITE_NAME,
      })
    : null;

  if (env.IA_PROVEEDOR === 'simulado') return crearProveedorSimulado();
  if (env.IA_PROVEEDOR === 'gemini') return gemini;
  if (env.IA_PROVEEDOR === 'openrouter') return openrouter;
  if (env.IA_PROVEEDOR === 'auto') {
    if (!gemini && !openrouter) return null;
    if (!gemini) return openrouter;
    if (!openrouter) return gemini;

    // Gemini queda como primera opción. Si devuelve 429/5xx por saturación,
    // los pedidos que trabajan con texto pueden pasar automáticamente a OpenRouter.
    return {
      nombre: 'auto',
      modelo: `${gemini.modelo} → ${openrouter.modelo}`,
      async identificar(args) {
        try {
          return await gemini.identificar(args);
        } catch (error) {
          if (!args.usarArchivo && esFalloTransitorio(error)) {
            console.warn('⚠ Gemini no disponible; usando OpenRouter como respaldo:', error.message);
            return openrouter.identificar(args);
          }
          throw error;
        }
      },
      async generarReporte(args) {
        try {
          return await gemini.generarReporte(args);
        } catch (error) {
          if (!args.usarArchivo && esFalloTransitorio(error)) {
            console.warn('⚠ Gemini no disponible; usando OpenRouter como respaldo:', error.message);
            return openrouter.generarReporte(args);
          }
          throw error;
        }
      },
    };
  }
  return null;
}

const proveedor = crearProveedor();

export const obtenerProveedorIA = () => proveedor;

export const estadoIA = () => ({
  configurada: Boolean(proveedor),
  proveedor: proveedor?.nombre ?? 'ninguno',
  modelo: proveedor?.modelo ?? null,
  motivo: proveedor ? null
    : env.IA_PROVEEDOR === 'gemini'
      ? 'Falta GEMINI_API_KEY en el archivo .env'
      : env.IA_PROVEEDOR === 'openrouter'
        ? 'Falta OPENROUTER_API_KEY en el archivo .env'
        : env.IA_PROVEEDOR === 'auto'
          ? 'Falta GEMINI_API_KEY y/o OPENROUTER_API_KEY en el archivo .env'
          : 'IA desactivada (IA_PROVEEDOR=ninguno)',
});
