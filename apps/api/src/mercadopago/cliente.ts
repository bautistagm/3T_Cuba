/**
 * Conexión con Mercado Pago — SOLO LECTURA.
 *
 * Mercado Pago no da claves de "solo lectura": la clave de acceso también serviría para mover plata.
 * Por eso este archivo es la única puerta hacia Mercado Pago y está cerrado a propósito:
 * - Solo hace pedidos GET (no existe ninguna función que mande POST, PUT ni DELETE).
 * - Solo a una lista cerrada de direcciones de consulta. Cualquier otra dirección se rechaza antes de salir.
 * Ver docs/DISENO.md, regla 5.
 */

export const URL_MERCADO_PAGO = "https://api.mercadopago.com";

/** Direcciones de consulta permitidas. Nada que pueda crear, cambiar o mover plata. */
const DIRECCIONES_PERMITIDAS: readonly RegExp[] = [/^\/users\/me$/, /^\/v1\/payments\/search\?[A-Za-z0-9_.=&%:+-]*$/];

export class ErrorMercadoPago extends Error {
  constructor(
    mensaje: string,
    readonly codigo: "SIN_CLAVE" | "CLAVE_INVALIDA" | "NO_RESPONDE" | "RESPUESTA_RARA" | "DIRECCION_PROHIBIDA",
  ) {
    super(mensaje);
    this.name = "ErrorMercadoPago";
  }
}

export function direccionPermitida(ruta: string): boolean {
  return DIRECCIONES_PERMITIDAS.some((r) => r.test(ruta));
}

type Fetch = typeof fetch;

/** Hace una consulta GET a Mercado Pago. Única función que sale hacia Mercado Pago. */
export async function consultarMercadoPago(
  clave: string,
  ruta: string,
  opciones: { fetch?: Fetch; base?: string } = {},
): Promise<unknown> {
  if (!direccionPermitida(ruta)) {
    throw new ErrorMercadoPago("La app solo puede consultar Mercado Pago; esa dirección no está permitida.", "DIRECCION_PROHIBIDA");
  }
  const hacerPedido = opciones.fetch ?? fetch;
  let respuesta: Response;
  try {
    respuesta = await hacerPedido(`${opciones.base ?? URL_MERCADO_PAGO}${ruta}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${clave}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ErrorMercadoPago("Mercado Pago no respondió. Probá de nuevo en un rato.", "NO_RESPONDE");
  }
  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new ErrorMercadoPago(
      "Mercado Pago rechazó la clave. Revisá que en Render esté el Access Token de producción completo.",
      "CLAVE_INVALIDA",
    );
  }
  if (!respuesta.ok) {
    throw new ErrorMercadoPago(`Mercado Pago respondió con un error (${respuesta.status}). Probá de nuevo en un rato.`, "NO_RESPONDE");
  }
  try {
    return await respuesta.json();
  } catch {
    throw new ErrorMercadoPago("Mercado Pago respondió algo que no se pudo leer.", "RESPUESTA_RARA");
  }
}

/** Convierte un importe de Mercado Pago (número en pesos, ej. 1500.5) a centavos, sin usar decimales. */
export function importeACentavos(valor: unknown): bigint | null {
  if (typeof valor !== "number" && typeof valor !== "string") return null;
  const texto = String(valor).trim();
  const partes = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(texto);
  if (!partes) return null;
  const [, signo, enteros, decimales = ""] = partes;
  const centavos = BigInt(enteros ?? "0") * 100n + BigInt((decimales + "00").slice(0, 2));
  return signo === "-" ? -centavos : centavos;
}
