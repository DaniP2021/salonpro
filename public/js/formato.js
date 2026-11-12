// Formato de dinero y fechas en el cliente.
// Espeja las reglas del servidor: dinero en centavos, fechas "YYYY-MM-DD HH:MM".

const pad = (n) => String(n).padStart(2, '0');
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 1500050 -> "$ 15.000,50" */
export function dinero(centavos, simbolo = '$') {
  const n = Math.round(Number(centavos) || 0);
  const signo = n < 0 ? '-' : '';
  const v = Math.abs(n);
  const entero = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(v % 100).padStart(2, '0');
  return `${signo}${simbolo} ${entero},${dec}`;
}

/** Sin decimales, para tableros y gráficos. */
export function dineroCorto(centavos, simbolo = '$') {
  const n = Math.round(Number(centavos) || 0);
  const signo = n < 0 ? '-' : '';
  const v = Math.round(Math.abs(n) / 100);
  return `${signo}${simbolo} ${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** Miles compactos para ejes: 1250000 -> "$ 12,5k" */
export function dineroCompacto(centavos, simbolo = '$') {
  const pesos = Math.round((Number(centavos) || 0) / 100);
  if (Math.abs(pesos) >= 1000000) return `${simbolo} ${(pesos / 1000000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(pesos) >= 1000) return `${simbolo} ${(pesos / 1000).toFixed(pesos >= 10000 ? 0 : 1).replace('.', ',')}k`;
  return `${simbolo} ${pesos}`;
}

/** Convierte lo que escribe la persona a centavos. Misma lógica que el servidor. */
export function aCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor) : 0;
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
    else if (partes[1].length === 3) { entero = partes[0] + partes[1]; decimal = ''; }
    else { entero = partes[0]; decimal = partes[1]; }
  }
  decimal = (decimal || '').replace(/\D/g, '');
  if (decimal.length === 0) decimal = '00';
  else if (decimal.length === 1) decimal += '0';
  else decimal = decimal.slice(0, 2);
  const limpio = (entero || '0').replace(/\D/g, '') || '0';
  const centavos = Number(limpio) * 100 + Number(decimal);
  return negativo ? -centavos : centavos;
}

/** Centavos -> "15000,50" para precargar un input de dinero. */
export function dineroEditable(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const v = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.floor(v / 100)}${v % 100 ? `,${String(v % 100).padStart(2, '0')}` : ''}`;
}

export function parseFecha(texto) {
  if (texto instanceof Date) return texto;
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export function soloFecha(texto) {
  const d = parseFecha(texto);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}

export function hora(texto) {
  const d = parseFecha(texto);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** "11/11/2026" — formato de fecha de lectura habitual en Argentina. */
export function fechaNumerica(texto) {
  const d = parseFecha(texto);
  if (!d) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "11/11/2026 · 15:30" */
export function fechaCorta(texto) {
  const d = parseFecha(texto);
  if (!d) return '';
  return `${fechaNumerica(d)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "mié 11/11" — para encabezados donde el año se sobreentiende. */
export function fechaDiaCorta(texto) {
  const d = parseFecha(texto);
  if (!d) return '';
  return `${DIAS_CORTOS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** "miércoles 11 de noviembre, 15:30" */
export function fechaLarga(texto) {
  const d = parseFecha(texto);
  if (!d) return '';
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "11 de noviembre" */
export function fechaDia(texto) {
  const d = parseFecha(texto);
  return d ? `${d.getDate()} de ${MESES[d.getMonth()]}` : '';
}

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ahoraISO() {
  const d = new Date();
  return `${hoyISO()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function sumarDias(iso, dias) {
  const d = parseFecha(iso) || new Date();
  d.setDate(d.getDate() + Number(dias || 0));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lunes de la semana de la fecha dada. */
export function inicioSemana(iso) {
  const d = parseFecha(iso) || new Date();
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function inicioMes(iso = hoyISO()) {
  return `${iso.slice(0, 7)}-01`;
}

export function finMes(iso = hoyISO()) {
  const d = parseFecha(`${iso.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function horaAMinutos(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function minutosAHora(min) {
  const m = Math.max(0, Math.round(min));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function minutosEntre(a, b) {
  const da = parseFecha(a);
  const db = parseFecha(b);
  return da && db ? Math.round((db - da) / 60000) : 0;
}

/** "5491144556677" -> "+54 9 11 4455-6677" (aproximado, sólo para mostrar) */
export function telefonoLegible(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('549')) {
    return `+54 9 ${d.slice(3, 5)} ${d.slice(5, 9)}-${d.slice(9)}`;
  }
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor || '';
}

export function iniciales(nombre) {
  return String(nombre || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
}

export function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function plural(n, singular, plural_) {
  return `${n} ${n === 1 ? singular : (plural_ || `${singular}s`)}`;
}

export const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  atendido: 'Atendido',
  no_asistio: 'No vino',
  cancelado: 'Cancelado',
};

export const ETIQUETA_WA = {
  en_cola: 'En cola',
  enviado: 'Enviado',
  entregado: 'Entregado',
  leido: 'Leído',
  respondido: 'Respondido',
  fallido: 'Falló',
  cancelado: 'Cancelado',
};

export const ETIQUETA_METODO = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  mercadopago: 'Mercado Pago',
  otro: 'Otro',
};

export const ETIQUETA_MODALIDAD = {
  comision: 'Comisión',
  alquiler: 'Alquila espacio',
  mixta: 'Mixta',
};
