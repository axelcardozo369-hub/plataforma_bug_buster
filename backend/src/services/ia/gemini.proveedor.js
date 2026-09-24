import { GoogleGenAI, FileState, createPartFromUri, createUserContent } from '@google/genai';
import { SISTEMA, ESQUEMA_IDENTIFICACION, ESQUEMA_REPORTE, promptIdentificacion, promptReporte, MAX_CARACTERES_TEXTO } from './prompts.js';
import { ErrorIA, traducirError } from './errores.js';

const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ============================================================
// Proveedor Google Gemini (tier gratuito de Google AI Studio).
// PDF, imágenes, audio y video se suben con la Files API, que
// acepta archivos grandes sin mandarlos en el cuerpo del pedido.
// ============================================================
export function crearProveedorGemini({ apiKey, modelo, baseUrl }) {
  const ai = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });

  // Reintenta ante saturación momentánea (429/500/503)
  async function conReintentos(fn, intentos = 3) {
    for (let i = 1; ; i += 1) {
      try {
        return await fn();
      } catch (error) {
        const status = error?.status;
        if (i >= intentos || ![429, 500, 503].includes(status)) throw traducirError(error);
        await esperar(2000 * i * i);
      }
    }
  }

  async function subirArchivo({ ruta, mimeType, nombre }) {
    let archivo = await conReintentos(() => ai.files.upload({ file: ruta, config: { mimeType, displayName: nombre } }));
    const inicio = Date.now();
    // Videos y audios largos quedan "PROCESSING" un rato en Google
    while (archivo.state === FileState.PROCESSING) {
      if (Date.now() - inicio > 15 * 60 * 1000) throw new ErrorIA('El archivo tardó demasiado en procesarse en la IA', 504);
      await esperar(3000);
      archivo = await conReintentos(() => ai.files.get({ name: archivo.name }));
    }
    if (archivo.state === FileState.FAILED) throw new ErrorIA('La IA no pudo leer este archivo', 422);
    return { name: archivo.name, uri: archivo.uri, mimeType: archivo.mimeType, expira: archivo.expirationTime };
  }

  // Los archivos subidos a Gemini vencen (≈48 h): si venció, se sube de nuevo
  async function referenciaVigente(fuente) {
    const ref = fuente.ia_archivo;
    const vigente = ref?.uri && ref.expira && new Date(ref.expira).getTime() - Date.now() > 10 * 60 * 1000;
    if (vigente) return { ref, renovada: false };
    if (!fuente.archivo_ruta) return { ref: null, renovada: false };
    const nueva = await subirArchivo({ ruta: fuente.archivo_ruta, mimeType: fuente.mime_type, nombre: fuente.archivo_nombre });
    return { ref: nueva, renovada: true };
  }

  async function generarJSON(partes, esquema) {
    const respuesta = await conReintentos(() => ai.models.generateContent({
      model: modelo,
      contents: createUserContent(partes),
      config: {
        systemInstruction: SISTEMA,
        responseMimeType: 'application/json',
        responseJsonSchema: esquema,
        temperature: 0.2,
      },
    }));
    try {
      return JSON.parse(respuesta.text);
    } catch {
      throw new ErrorIA('La IA devolvió una respuesta incompleta. Probá de nuevo.', 502);
    }
  }

  return {
    nombre: 'gemini',
    modelo,

    // Identifica qué es la fuente y extrae su contenido
    async identificar({ fuente, texto, usarArchivo }) {
      const partes = [];
      let ia_archivo = null;
      if (usarArchivo) {
        const { ref } = await referenciaVigente(fuente);
        ia_archivo = ref;
        partes.push(createPartFromUri(ref.uri, ref.mimeType));
      }
      partes.push(promptIdentificacion({ nombre: fuente.archivo_nombre || fuente.titulo, tipo: fuente.tipo_fuente, conTexto: Boolean(texto) }));
      if (texto) partes.push(`CONTENIDO:\n${texto.slice(0, MAX_CARACTERES_TEXTO)}`);
      const resultado = await generarJSON(partes, ESQUEMA_IDENTIFICACION);
      return { ...resultado, ia_archivo };
    },

    // Responde la consulta del usuario sobre la fuente
    async generarReporte({ fuente, consulta, texto, analisis, usarArchivo }) {
      const partes = [];
      let ia_archivo = null;
      if (usarArchivo) {
        const { ref, renovada } = await referenciaVigente(fuente);
        if (ref) {
          partes.push(createPartFromUri(ref.uri, ref.mimeType));
          if (renovada) ia_archivo = ref;
        }
      }
      partes.push(promptReporte({ consulta, fuente, analisis }));
      if (texto) partes.push(`CONTENIDO DE LA FUENTE:\n${texto.slice(0, MAX_CARACTERES_TEXTO)}`);
      const reporte = await generarJSON(partes, ESQUEMA_REPORTE);
      return { reporte, ia_archivo };
    },
  };
}
