/**
 * DNI y CUIL.
 *
 * El CUIL/CUIT es el DNI con dos números adelante y uno atrás: 20-30123456-7.
 * Los DNI de menos de 8 cifras van con ceros a la izquierda adentro del CUIL: 20-07123456-3.
 * La app guarda el DNI solo con números y sin ceros a la izquierda ("30123456").
 */

const DNI_MINIMO = 1_000_000;
const DNI_MAXIMO = 99_999_999;

/** "30.123.456", "30 123 456" o "30123456" → "30123456". null si no es un DNI válido. */
export function normalizarDni(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpio = texto.trim();
  if (!/^[\d.\s-]+$/.test(limpio)) return null;
  const digitos = limpio.replace(/\D/g, "").replace(/^0+/, "");
  if (digitos.length < 7 || digitos.length > 8) return null;
  const n = Number(digitos);
  if (n < DNI_MINIMO || n > DNI_MAXIMO) return null;
  return digitos;
}

/** El DNI que está adentro de un CUIL/CUIT: los 8 números del medio. null si no es un CUIL de 11 números. */
export function dniDeCuil(cuil: string | null | undefined): string | null {
  if (!cuil) return null;
  const digitos = cuil.replace(/\D/g, "");
  if (digitos.length !== 11) return null;
  return normalizarDni(digitos.slice(2, 10));
}

/** "30123456" → "30.123.456", para mostrar. */
export function formatearDni(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
