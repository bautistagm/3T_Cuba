/** Ayudas para leer las respuestas de Mercado Pago sin confiar en su forma. */

export function leer(objeto: unknown, ruta: string): unknown {
  let actual: unknown = objeto;
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

export function texto(valor: unknown): string | null {
  if (typeof valor === "string") return valor.trim() === "" ? null : valor.trim().slice(0, 120);
  if (typeof valor === "number" || typeof valor === "bigint") return String(valor);
  return null;
}
