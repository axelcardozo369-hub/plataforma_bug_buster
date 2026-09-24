// Error de IA con un código HTTP y un mensaje entendible para el usuario
export class ErrorIA extends Error {
  constructor(mensaje, status = 502) {
    super(mensaje);
    this.status = status;
  }
}

export function traducirError(error) {
  if (error instanceof ErrorIA) return error;
  const status = error?.status ?? error?.code;
  const texto = String(error?.message || '');
  if (status === 429 || /quota|rate.?limit|too many requests/i.test(texto)) {
    return new ErrorIA('Se alcanzó el límite gratuito de la IA. Esperá un minuto y volvé a intentar.', 429);
  }
  if (status === 400 && /api key|authentication|token/i.test(texto)) return new ErrorIA('La clave de IA no es válida. Revisá GEMINI_API_KEY u OPENROUTER_API_KEY.', 503);
  if (status === 401 || status === 403) return new ErrorIA('La clave de IA no tiene permiso. Revisá la clave configurada en el proveedor.', 503);
  if (status === 404) return new ErrorIA('El modelo configurado no existe o no está disponible. Revisá GEMINI_MODEL u OPENROUTER_MODEL.', 503);
  if ([408, 500, 502, 503, 504].includes(Number(status))) return new ErrorIA('El servicio de IA está temporalmente saturado o no disponible. Probá de nuevo en unos segundos.', Number(status));
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(texto)) {
    return new ErrorIA('No hay conexión con el servicio de IA. Revisá la conexión a internet del servidor.', 503);
  }
  return new ErrorIA(`La IA no pudo procesar el pedido: ${texto.slice(0, 200)}`, 502);
}
