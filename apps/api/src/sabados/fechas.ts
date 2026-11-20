/** Fechas en hora de Argentina (UTC-3, sin horario de verano). */

const ZONA = "America/Argentina/Buenos_Aires";

function partesEnArgentina(momento: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(momento);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    fecha: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: Number(valor("hour")),
    diaSemana: dias.indexOf(valor("weekday")),
  };
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * El sábado que corresponde a este momento:
 * - un sábado, ese mismo día;
 * - el domingo de madrugada (antes de las 8), el sábado anterior: el tercer tiempo sigue después de las 12;
 * - cualquier otro día, el próximo sábado.
 */
export function sabadoCorrespondiente(ahora: Date = new Date()): string {
  const { fecha, hora, diaSemana } = partesEnArgentina(ahora);
  if (diaSemana === 6) return fecha;
  if (diaSemana === 0 && hora < 8) return sumarDias(fecha, -1);
  return sumarDias(fecha, 6 - diaSemana);
}

export function esSabado(fecha: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && new Date(`${fecha}T12:00:00Z`).getUTCDay() === 6;
}
