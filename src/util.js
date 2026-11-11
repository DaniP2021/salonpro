// Utilidades transversales: fechas en texto local, dinero en centavos, validaciones.
//
// Decisiones:
//  - Las fechas se guardan como texto "YYYY-MM-DD HH:MM" (hora local del negocio).
//    Ese formato ordena lexicográficamente igual que el tiempo, así que sirve para
//    comparar y para BETWEEN sin conversiones.
//  - El dinero se guarda y se transporta SIEMPRE en centavos enteros.
//    Nunca se usa punto flotante para plata.

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');

/** Date -> "YYYY-MM-DD" */
export function soloFecha(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date -> "YYYY-MM-DD HH:MM" */
export function aTextoFecha(d) {
  return `${soloFecha(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD[ HH:MM[:SS]]" | "YYYY-MM-DDTHH:MM" -> Date local, o null */
export function parseFecha(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor !== 'string') return null;
  const m = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0), 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Valida y normaliza a "YYYY-MM-DD HH:MM". Lanza error si es inválida. */
export function exigirFecha(valor, campo = 'fecha') {
  const d = parseFecha(valor);
  if (!d) throw new ErrorApp(`El campo ${campo} no es una fecha válida (se espera AAAA-MM-DD HH:MM).`);
  return aTextoFecha(d);
}

export function ahora() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

export function ahoraTexto() {
  return aTextoFecha(ahora());
}

export function hoyTexto() {
  return soloFecha(ahora());
}

/** Suma minutos a un texto de fecha y devuelve texto. */
export function sumarMinutos(texto, minutos) {
  const d = parseFecha(texto);
  if (!d) throw new Error(`Fecha inválida: ${texto}`);
  d.setMinutes(d.getMinutes() + Number(minutos || 0));
  return aTextoFecha(d);
}

/** Diferencia en minutos entre dos textos de fecha (b - a). */
export function difMinutos(a, b) {
  const da = parseFecha(a), db = parseFecha(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 60000);
}

export function sumarDias(texto, dias) {
  const d = parseFecha(texto);
  if (!d) throw new Error(`Fecha inválida: ${texto}`);
  d.setDate(d.getDate() + Number(dias || 0));
  return soloFecha(d);
}

/** Primer día del mes de una fecha (texto "YYYY-MM-DD"). */
export function inicioDeMes(texto = hoyTexto()) {
  return `${texto.slice(0, 7)}-01`;
}

export function finDeMes(texto = hoyTexto()) {
  const d = parseFecha(`${texto.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return soloFecha(d);
}

/** Lunes de la semana de una fecha. */
export function inicioDeSemana(texto = hoyTexto()) {
  const d = parseFecha(texto);
  const dow = d.getDay(); // 0 domingo
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + delta);
  return soloFecha(d);
}

export function diaSemana(texto) {
  const d = parseFecha(texto);
  return d ? d.getDay() : null;
}

/** "2026-11-11 15:30" -> "miércoles 11 de noviembre, 15:30" */
export function fechaLarga(texto) {
  const d = parseFecha(texto);
  if (!d) return texto;
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-11-11 15:30" -> "mié 11/11 15:30" */
export function fechaCorta(texto) {
  const d = parseFecha(texto);
  if (!d) return texto || '';
  return `${DIAS_CORTOS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "15:30" -> minutos desde las 00:00 */
export function horaAMinutos(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minutos -> "HH:MM" */
export function minutosAHora(min) {
  const m = Math.max(0, Math.round(min));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

// ---------------------------------------------------------------- dinero

/**
 * Convierte lo que escribe una persona a centavos enteros.
 * Acepta "15000", "15.000", "15.000,50", "15000.50", "15,5", "$ 1.234".
 * Un número se interpreta como centavos ya calculados (uso interno / API).
 */
export function aCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor) : 0;
  if (typeof valor === 'boolean') return 0;
  let s = String(valor).trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const negativo = s.startsWith('-');
  s = s.replace(/-/g, '');
  const ultimaComa = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');
  let entero = s;
  let decimal = '';
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    if (ultimaComa > ultimoPunto) {
      entero = s.slice(0, ultimaComa).replace(/\./g, '');
      decimal = s.slice(ultimaComa + 1);
    } else {
      entero = s.slice(0, ultimoPunto).replace(/,/g, '');
      decimal = s.slice(ultimoPunto + 1);
    }
  } else if (ultimaComa >= 0) {
    const partes = s.split(',');
    if (partes.length > 2) { entero = s.replace(/,/g, ''); decimal = ''; }
    else { entero = partes[0]; decimal = partes[1]; }
  } else if (ultimoPunto >= 0) {
    const partes = s.split('.');
    if (partes.length > 2) { entero = s.replace(/\./g, ''); decimal = ''; }
    else if (partes[1].length === 3) { entero = partes[0] + partes[1]; decimal = ''; } // 15.000
    else { entero = partes[0]; decimal = partes[1]; }
  }
  decimal = (decimal || '').replace(/\D/g, '');
  if (decimal.length === 0) decimal = '00';
  else if (decimal.length === 1) decimal += '0';
  else decimal = decimal.slice(0, 2);
  const enteroLimpio = (entero || '0').replace(/\D/g, '') || '0';
  const centavos = Number(enteroLimpio) * 100 + Number(decimal);
  return negativo ? -centavos : centavos;
}

/** 1500050 -> "$ 15.000,50" */
export function fmtMoneda(centavos, simbolo = '$') {
  const n = Math.round(Number(centavos) || 0);
  const signo = n < 0 ? '-' : '';
  const v = Math.abs(n);
  const entero = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(v % 100).padStart(2, '0');
  return `${signo}${simbolo} ${entero},${dec}`;
}

/** 1500050 -> "$ 15.000" (sin decimales, para gráficos y tableros) */
export function fmtMonedaCorto(centavos, simbolo = '$') {
  return fmtMoneda(centavos, simbolo).replace(/,\d{2}$/, '');
}

/** Porcentaje de un monto en centavos, redondeado al centavo (mitad hacia arriba). */
export function pctDe(centavos, porcentaje) {
  const p = Number(porcentaje) || 0;
  const bruto = Number(centavos) || 0;
  return Math.round((bruto * p) / 100);
}

// ---------------------------------------------------------- validaciones

export function texto(valor, max = 500) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim().slice(0, max);
}

export function textoObligatorio(valor, campo, max = 300) {
  const t = texto(valor, max);
  if (!t) throw new ErrorApp(`El campo ${campo} es obligatorio.`);
  return t;
}

export function entero(valor, porDefecto = 0) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) ? n : porDefecto;
}

export function enteroPositivo(valor, campo) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n) || n < 0) throw new ErrorApp(`El campo ${campo} debe ser un número entero mayor o igual a 0.`);
  return n;
}

export function decimal(valor, porDefecto = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

export function porcentaje(valor, campo = 'porcentaje') {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ErrorApp(`El campo ${campo} debe estar entre 0 y 100.`);
  return Math.round(n * 100) / 100;
}

export function booleano(valor, porDefecto = false) {
  if (valor === null || valor === undefined || valor === '') return porDefecto;
  if (typeof valor === 'boolean') return valor;
  const s = String(valor).toLowerCase().trim();
  return ['1', 'true', 'si', 'sí', 's', 'yes', 'on'].includes(s);
}

export function soloDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/** Deja el teléfono en formato internacional sin signos: 5491122334455 */
export function normalizarTelefono(valor) {
  let d = soloDigitos(valor);
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  // Argentina: 11 2233-4455 -> 5491122334455
  if (d.length === 10 && d.startsWith('1')) return `549${d}`;
  if (d.length === 11 && d.startsWith('54')) return d;
  if (d.length === 12 && d.startsWith('549')) return d;
  if (d.length === 13 && d.startsWith('540')) return `549${d.slice(3)}`;
  return d;
}

export function emailValido(valor) {
  const s = texto(valor, 200);
  if (!s) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s.toLowerCase() : null;
}

export function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slug(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Error de aplicación con código HTTP. El router lo traduce a una respuesta JSON. */
export class ErrorApp extends Error {
  constructor(mensaje, estado = 400, detalles = null) {
    super(mensaje);
    this.name = 'ErrorApp';
    this.estado = estado;
    this.detalles = detalles;
  }
}

export function validar(condicion, mensaje, estado = 400) {
  if (!condicion) throw new ErrorApp(mensaje, estado);
}

/** Rango de fechas con valores por defecto razonables. */
export function rango(desde, hasta) {
  const hoy = hoyTexto();
  const d = desde ? String(desde).slice(0, 10) : inicioDeMes(hoy);
  const h = hasta ? String(hasta).slice(0, 10) : finDeMes(hoy);
  if (!parseFecha(d) || !parseFecha(h)) throw new ErrorApp('Rango de fechas inválido.');
  if (d > h) throw new ErrorApp('La fecha desde no puede ser posterior a la fecha hasta.');
  // Se compara por día completo: "2026-11-11" cubre hasta "2026-11-11 23:59".
  return { desde: d, hasta: `${h} 23:59` };
}
