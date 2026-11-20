/**
 * Utilidades de dinero.
 *
 * Regla del proyecto: todos los montos se manejan en CENTAVOS, como enteros `bigint`.
 * Nunca se usan números con decimales (float) para plata.
 *
 * En la API los montos viajan como texto con los centavos ("3000000" = $30.000),
 * porque JSON no tiene enteros grandes y no queremos redondeos.
 */
import { z } from "zod";

/** Tope de seguridad para cualquier monto ingresado: $10.000.000.000 (diez mil millones). */
export const MONTO_MAXIMO_CENTAVOS = 1_000_000_000_000n;

export class MontoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "MontoInvalidoError";
  }
}

// Formato argentino: punto para miles (opcional, en grupos de 3) y coma para decimales (hasta 2).
// Ejemplos válidos: "30000", "30.000", "30.000,5", "30.000,50", "$ 30.000".
const FORMATO_PESOS = /^\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Convierte un monto escrito por una persona ("30.000", "$ 1.250,50") a centavos.
 * Solo acepta montos mayores a cero: el signo (entrada o salida) lo decide el sistema, no quien escribe.
 */
export function pesosACentavos(texto: string): bigint {
  const limpio = texto.trim();
  const coincidencia = FORMATO_PESOS.exec(limpio);
  if (!coincidencia) {
    throw new MontoInvalidoError(`"${texto}" no es un monto válido. Ejemplos: 30000, 30.000 o 30.000,50`);
  }
  const enteros = (coincidencia[1] ?? "").replaceAll(".", "");
  const decimales = (coincidencia[2] ?? "").padEnd(2, "0");
  const resultado = BigInt(enteros) * 100n + BigInt(decimales);
  validarMontoPositivo(resultado);
  return resultado;
}

/** Lanza un error si el monto no es mayor a cero o supera el tope de seguridad. */
export function validarMontoPositivo(centavos: bigint): void {
  if (centavos <= 0n) {
    throw new MontoInvalidoError("El monto tiene que ser mayor a cero.");
  }
  if (centavos > MONTO_MAXIMO_CENTAVOS) {
    throw new MontoInvalidoError("El monto supera el máximo permitido.");
  }
}

/** Muestra centavos como pesos argentinos: 3000000n → "$30.000", 125050n → "$1.250,50", -500n → "-$5". */
export function formatearPesos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = negativo ? -centavos : centavos;
  const enteros = (absoluto / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const resto = absoluto % 100n;
  const decimales = resto === 0n ? "" : "," + resto.toString().padStart(2, "0");
  return `${negativo ? "-" : ""}$${enteros}${decimales}`;
}

/** Suma montos en centavos sin perder precisión. */
export function sumarCentavos(montos: readonly bigint[]): bigint {
  return montos.reduce((total, monto) => total + monto, 0n);
}

/** Pasa centavos a texto para mandarlos por la API. */
export function centavosATexto(centavos: bigint): string {
  return centavos.toString();
}

/** Esquema para montos que llegan por la API como texto de centavos. Acepta negativos (ej. saldos). */
export const centavosSchema = z
  .string()
  .regex(/^-?\d{1,15}$/, "El monto tiene que ser un número entero de centavos.")
  .transform((texto) => BigInt(texto));

/** Esquema para montos ingresados (pagos, gastos, precios): enteros de centavos, mayores a cero y bajo el tope. */
export const montoPositivoSchema = centavosSchema.refine(
  (centavos) => centavos > 0n && centavos <= MONTO_MAXIMO_CENTAVOS,
  "El monto tiene que ser mayor a cero y no superar el máximo permitido.",
);
