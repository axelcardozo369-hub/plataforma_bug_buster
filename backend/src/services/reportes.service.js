import { analizarContenido } from '../utils/analizador.js';
import { textoParaAnalizar } from './extractor.service.js';
import { obtenerProveedorIA } from './ia/index.js';
import { ErrorIA } from './ia/errores.js';

const numero = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });

// Reporte básico, sin IA: no interpreta la consulta, pero da cifras reales
export function reporteLocal(analisis, fuente) {
  const r = { indicadores: [], hallazgos: [], recomendaciones: [], tabla: { titulo: '', columnas: [], filas: [] } };
  if (analisis.tipo === 'tabla') {
    r.indicadores.push({ nombre: 'Registros', valor: numero(analisis.filas), contexto: `${analisis.columnas} columnas de datos.` });
    r.indicadores.push({ nombre: 'Datos completos', valor: `${numero(analisis.completitud_pct)}%`, contexto: `${analisis.celdas_vacias} celdas vacías.` });
    analisis.numericas.slice(0, 3).forEach((c) => r.indicadores.push({
      nombre: `Total de ${c.columna}`, valor: numero(c.suma), contexto: `Promedio ${numero(c.promedio)} · mín. ${numero(c.minimo)} · máx. ${numero(c.maximo)}.`,
    }));
    analisis.categoricas.slice(0, 3).forEach((c) => r.hallazgos.push(
      `En ${c.columna}, lo más frecuente es "${c.top[0].valor}" (${c.top[0].cantidad} de ${analisis.filas}).`
    ));
    analisis.fechas.slice(0, 1).forEach((f) => r.hallazgos.push(`Los datos van del ${f.desde} al ${f.hasta}.`));
    if (analisis.filas_duplicadas) r.recomendaciones.push(`Revisar ${analisis.filas_duplicadas} registro(s) duplicado(s).`);
    if (analisis.completitud_pct < 95) r.recomendaciones.push('Completar las celdas vacías para que los totales sean confiables.');
    const cat = analisis.categoricas[0];
    if (cat) r.tabla = { titulo: `Valores más frecuentes de ${cat.columna}`, columnas: [cat.columna, 'Cantidad'], filas: cat.top.map((t) => [t.valor, String(t.cantidad)]) };
  } else {
    r.indicadores.push({ nombre: 'Palabras', valor: numero(analisis.palabras), contexto: `${analisis.lineas} líneas de texto.` });
  }
  return {
    titulo: `Resumen de ${fuente.titulo}`.slice(0, 200),
    resumen_ejecutivo: fuente.descripcion_ia || `${fuente.titulo}: ${analisis.filas ?? analisis.lineas} registros.`,
    ...r,
    limitaciones: 'Reporte básico sin IA: muestra cifras de la fuente pero no interpreta tu consulta. Configurá GEMINI_API_KEY para respuestas a medida.',
  };
}

// Qué se le manda a la IA: el archivo original cuando "verlo" aporta
// (PDF con tablas o gráficos, imágenes); para audio y video alcanza con la
// transcripción ya hecha, así se ahorra cuota gratuita.
function debeUsarArchivo(fuente) {
  if (!fuente.archivo_ruta) return false;
  if (['pdf', 'imagen'].includes(fuente.tipo_fuente)) return true;
  if (['audio', 'video'].includes(fuente.tipo_fuente)) return !fuente.contenido_crudo;
  return false;
}

// Arma el BORRADOR del reporte (no lo guarda): el usuario lo revisa antes
export async function generarBorrador({ fuente, consulta }) {
  const base = textoParaAnalizar(fuente);
  const analisis = base ? analizarContenido(base) : null;
  // A la IA solo se le pasan cálculos de tablas (sin la lista de encabezados)
  const calculos = analisis?.tipo === 'tabla' ? { ...analisis, encabezados: undefined } : null;

  const ia = obtenerProveedorIA();
  let reporte;
  let origen = 'local';
  let modelo_ia = null;
  let ia_archivo = null;

  if (ia) {
    const resultado = await ia.generarReporte({
      fuente,
      consulta,
      texto: fuente.contenido_crudo,
      analisis: calculos,
      usarArchivo: debeUsarArchivo(fuente),
    });
    reporte = resultado.reporte;
    ia_archivo = resultado.ia_archivo;
    origen = 'ia';
    modelo_ia = ia.modelo;
  } else if (analisis) {
    reporte = reporteLocal(analisis, fuente);
  } else {
    throw new ErrorIA('Para generar reportes de PDF, imágenes, audio o video hace falta configurar la IA (GEMINI_API_KEY).', 503);
  }

  const { titulo, resumen_ejecutivo, ...resto } = reporte;
  return {
    borrador: {
      data_source_id: fuente.id,
      consulta,
      titulo,
      resumen_ejecutivo,
      origen,
      modelo_ia,
      metricas_clave: { tipo: 'reporte', ...resto, analisis_local: calculos },
    },
    ia_archivo,
  };
}
