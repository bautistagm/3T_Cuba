/**
 * Cómo se le pide algo a Gemini (plan gratis), para todos los usos de la IA.
 *
 * El plan gratis a veces está saturado (error 503) o con demasiados pedidos (429). Por eso:
 *  - se reintenta el mismo modelo después de unos segundos,
 *  - y si sigue fallando se prueba el siguiente modelo de la lista.
 * Si nada funciona, el error se explica en castellano, sin texto técnico.
 */

/** Errores del servicio que suelen pasar solos: vale la pena esperar y reintentar. */
const PASAJEROS = new Set([429, 500, 503]);
/** Errores por los que conviene probar otro modelo (incluye "ese modelo ya no existe"). */
const PROBAR_OTRO = new Set([404, ...PASAJEROS]);

export const estadoDeError = (error: unknown): number | undefined => {
  const estado = (error as { status?: unknown }).status;
  return typeof estado === "number" ? estado : undefined;
};

const esperar = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms));

/** Explica un error de la IA para mostrárselo a una persona. */
export function explicarErrorIa(error: unknown): string {
  const estado = estadoDeError(error);
  if (estado === 503 || estado === 500) return "La IA de Google está saturada en este momento. Probá de nuevo en uno o dos minutos.";
  if (estado === 429) return "Se usó mucho la IA en poco tiempo (límite del plan gratis). Probá de nuevo en uno o dos minutos.";
  if (estado === 400 || estado === 401 || estado === 403) return "La IA rechazó el pedido. Revisá que la clave GEMINI_API_KEY de Render sea correcta.";
  if (error instanceof Error && /timeout|abort/i.test(error.message)) return "La IA tardó demasiado en responder. Probá de nuevo.";
  if (error instanceof Error && error.message.length < 160 && !error.message.includes("{")) return error.message;
  return "La IA no respondió bien. Probá de nuevo en un rato.";
}

/**
 * Prueba cada modelo en orden, reintentando el mismo modelo ante errores pasajeros.
 * `esperas` son los segundos de espera entre reintentos del mismo modelo (por defecto 2 y 5).
 */
export async function conModelos<T>(
  modelos: readonly string[],
  pedido: (modelo: string) => Promise<T>,
  opciones: { esperasMs?: readonly number[] } = {},
): Promise<T> {
  const esperas = opciones.esperasMs ?? [2_000, 5_000];
  let ultimoError: unknown = new Error("No hay modelos de IA configurados.");
  for (const modelo of modelos) {
    for (let intento = 0; intento <= esperas.length; intento++) {
      try {
        return await pedido(modelo);
      } catch (error) {
        ultimoError = error;
        const estado = estadoDeError(error);
        if (estado !== undefined && PASAJEROS.has(estado) && intento < esperas.length) {
          await esperar(esperas[intento] ?? 0);
          continue;
        }
        break;
      }
    }
    const estado = estadoDeError(ultimoError);
    if (estado !== undefined && !PROBAR_OTRO.has(estado)) break;
  }
  throw ultimoError;
}
