import { ESQUEMA_IDENTIFICACION, ESQUEMA_REPORTE, promptIdentificacion, promptReporte, SISTEMA, MAX_CARACTERES_TEXTO } from './prompts.js';
import { ErrorIA, traducirError } from './errores.js';

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function esquemaEstrictamenteJSON(esquema) {
  if (!esquema || typeof esquema !== 'object') return esquema;
  const salida = { ...esquema };
  if (salida.type === 'object' && salida.properties) {
    salida.properties = Object.fromEntries(Object.entries(salida.properties).map(([clave, valor]) => [clave, esquemaEstrictamenteJSON(valor)]));
    salida.additionalProperties = false;
    salida.required = salida.required || Object.keys(salida.properties);
  }
  if (salida.type === 'array' && salida.items) salida.items = esquemaEstrictamenteJSON(salida.items);
  return salida;
}

function partesATexto(partes) {
  return partes
    .filter((parte) => typeof parte === 'string')
    .join('\n\n');
}

// OpenRouter expone una API compatible con Chat Completions y permite usar
// modelos gratuitos mediante el router "openrouter/free".
export function crearProveedorOpenRouter({ apiKey, modelo = 'openrouter/free', siteUrl = '', siteName = 'InfoHub' }) {
  async function pedir(body, intentos = 3) {
    for (let intento = 1; intento <= intentos; intento += 1) {
      try {
        const respuesta = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
            'X-OpenRouter-Title': siteName,
          },
          body: JSON.stringify(body),
        });

        const data = await respuesta.json().catch(() => null);
        if (respuesta.ok) return data;

        const error = new Error(data?.error?.message || `OpenRouter respondió HTTP ${respuesta.status}`);
        error.status = respuesta.status;
        error.code = data?.error?.code;
        throw error;
      } catch (error) {
        const status = error?.status;
        const reintentable = [408, 429, 500, 502, 503, 504].includes(status);
        if (!reintentable || intento >= intentos) throw traducirError(error);
        await esperar(1000 * intento * intento);
      }
    }
    throw new ErrorIA('No se pudo contactar al servicio de IA.', 503);
  }

  async function generarJSON(partes, esquema) {
    const contenido = partesATexto(partes);
    if (!contenido.trim()) throw new ErrorIA('No hay contenido para enviar a la IA.', 422);

    const data = await pedir({
      model: modelo,
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: contenido.slice(0, MAX_CARACTERES_TEXTO) },
      ],
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'infohub_respuesta',
          strict: true,
          schema: esquemaEstrictamenteJSON(esquema),
        },
      },
      // Si un modelo gratuito no admite una función avanzada, OpenRouter
      // puede elegir otro modelo gratuito que sí la soporte.
      provider: { require_parameters: true },
    });

    const texto = data?.choices?.[0]?.message?.content;
    if (!texto) throw new ErrorIA('La IA no devolvió contenido.', 502);
    try {
      return JSON.parse(texto);
    } catch {
      throw new ErrorIA('La IA devolvió una respuesta que no tiene formato JSON válido. Probá de nuevo.', 502);
    }
  }

  return {
    nombre: 'openrouter',
    modelo,
    async identificar({ fuente, texto, usarArchivo }) {
      if (usarArchivo) {
        // Esta implementación gratuita trabaja con texto. Los formatos que
        // necesitan visión/audio/video siguen usando Gemini.
        throw new ErrorIA('OpenRouter no está configurado para procesar directamente este archivo. Usá Gemini para PDF, imágenes, audio o video.', 422);
      }
      const partes = [
        promptIdentificacion({ nombre: fuente.archivo_nombre || fuente.titulo, tipo: fuente.tipo_fuente, conTexto: Boolean(texto) }),
      ];
      if (texto) partes.push(`CONTENIDO:\n${texto.slice(0, MAX_CARACTERES_TEXTO)}`);
      const resultado = await generarJSON(partes, ESQUEMA_IDENTIFICACION);
      return { ...resultado, ia_archivo: null };
    },

    async generarReporte({ fuente, consulta, texto, analisis, usarArchivo }) {
      if (usarArchivo) {
        throw new ErrorIA('OpenRouter no está configurado para procesar directamente este archivo. Usá Gemini para PDF, imágenes, audio o video.', 422);
      }
      const partes = [promptReporte({ consulta, fuente, analisis })];
      if (texto) partes.push(`CONTENIDO DE LA FUENTE:\n${texto.slice(0, MAX_CARACTERES_TEXTO)}`);
      const reporte = await generarJSON(partes, ESQUEMA_REPORTE);
      return { reporte, ia_archivo: null };
    },
  };
}
