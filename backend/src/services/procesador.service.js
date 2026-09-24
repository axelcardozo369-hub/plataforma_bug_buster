import { DataSource } from '../models/index.js';
import { detectarTipo } from '../utils/tiposArchivo.js';
import { analizarContenido, generarResumen } from '../utils/analizador.js';
import { extraerTextoLocal, textoParaAnalizar } from './extractor.service.js';
import { obtenerProveedorIA } from './ia/index.js';
import { traducirError } from './ia/errores.js';

const enCurso = new Set();

// ============================================================
// Procesa una fuente EN SEGUNDO PLANO después de subirla:
//  1. Extrae el texto localmente si se puede (CSV, JSON, Excel, Word...)
//  2. Si hay IA: identifica qué es, transcribe/extrae PDF, imagen, audio
//     o video y propone preguntas útiles.
// El usuario no espera: la fuente aparece como "procesando" y se actualiza sola.
// ============================================================
export async function procesarFuente(id) {
  if (enCurso.has(id)) return;
  enCurso.add(id);
  try {
    const fuente = await DataSource.findByPk(id);
    if (!fuente) return;
    await fuente.update({ estado_ia: 'procesando', error_ia: null }, { silent: true });

    const deteccion = fuente.archivo_ruta
      ? detectarTipo(fuente.archivo_nombre, fuente.mime_type)
      : { modo: 'pegado' };

    const cambios = { metadata: { ...(fuente.metadata || {}) } };
    let texto = fuente.contenido_crudo;

    if (fuente.archivo_ruta && deteccion.modo !== 'ia') {
      const extraido = await extraerTextoLocal(fuente.archivo_ruta, deteccion.modo);
      texto = extraido.texto;
      Object.assign(cambios.metadata, extraido.detalle);
      if (texto != null) cambios.contenido_crudo = texto;
    }

    const ia = obtenerProveedorIA();
    const necesitaArchivo = deteccion.modo === 'ia';

    if (!ia) {
      // Sin IA: lo que es texto se describe localmente; el resto queda guardado
      if (texto) {
        const analisis = analizarContenido(textoParaAnalizar({ ...fuente.get(), ...cambios }));
        cambios.descripcion_ia = generarResumen(analisis, fuente.titulo);
      } else {
        cambios.error_ia = 'Para leer PDF, imágenes, audio o video hace falta configurar la IA (GEMINI_API_KEY).';
      }
      cambios.estado_ia = 'sin_ia';
    } else if (!texto && !necesitaArchivo) {
      cambios.estado_ia = 'error';
      cambios.error_ia = 'Formato no reconocido: el archivo quedó guardado, pero no se puede leer su contenido.';
    } else {
      const resultado = await ia.identificar({
        fuente: { ...fuente.get(), ...cambios },
        texto: texto || null,
        usarArchivo: necesitaArchivo,
      });
      cambios.descripcion_ia = resultado.descripcion;
      cambios.metadata.tipo_contenido = resultado.tipo_contenido;
      cambios.sugerencias = resultado.sugerencias?.slice(0, 5) ?? [];
      if (!texto && resultado.contenido_extraido) cambios.contenido_crudo = resultado.contenido_extraido;
      if (resultado.ia_archivo) cambios.ia_archivo = resultado.ia_archivo;
      cambios.estado_ia = 'listo';
    }

    await fuente.update(cambios, { silent: true });
  } catch (error) {
    console.error(`✖ Error procesando fuente ${id}:`, error.message);
    await DataSource.update(
      { estado_ia: 'error', error_ia: traducirError(error).message },
      { where: { id }, silent: true }
    ).catch(() => {});
  } finally {
    enCurso.delete(id);
  }
}

// Al reiniciar el servidor, retoma las fuentes que quedaron a medio procesar
export async function retomarPendientes() {
  const pendientes = await DataSource.findAll({
    where: { estado_ia: ['pendiente', 'procesando'] },
    attributes: ['id'],
  });
  pendientes.forEach((f) => { procesarFuente(f.id); });
  return pendientes.length;
}
