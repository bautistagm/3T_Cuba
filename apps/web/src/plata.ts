import { formatearPesos, MontoInvalidoError, pesosACentavos } from "@3t/shared";

/** Los montos llegan de la API como texto de centavos ("1500000" = $15.000). */
export const pesos = (centavos: string | bigint | null | undefined): string =>
  centavos === null || centavos === undefined ? "—" : formatearPesos(BigInt(centavos));

/** Lee un monto escrito por la persona. Devuelve los centavos como texto, o un mensaje de error. */
export function leerMonto(texto: string): { ok: true; centavos: string } | { ok: false; error: string } {
  try {
    return { ok: true, centavos: pesosACentavos(texto).toString() };
  } catch (e) {
    return { ok: false, error: e instanceof MontoInvalidoError ? e.message : "Monto inválido." };
  }
}

const formatoFecha = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const fechaLarga = (aaaammdd: string) => formatoFecha.format(new Date(`${aaaammdd}T12:00:00Z`));

const formatoHora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
export const hora = (iso: string) => formatoHora.format(new Date(iso));

/** Un monto en centavos como texto para editar en un campo (ej: "15000" o "15000,50"). */
export const montoParaEditar = (centavos: string | bigint): string => {
  const c = BigInt(centavos);
  const resto = c % 100n;
  return `${c / 100n}${resto === 0n ? "" : `,${resto.toString().padStart(2, "0")}`}`;
};
