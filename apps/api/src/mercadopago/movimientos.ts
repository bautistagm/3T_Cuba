/**
 * Entradas aprobadas a la cuenta de Mercado Pago en un rango de fechas, listas para cruzar.
 * Solo consulta (ver cliente.ts). No guarda nada: guardar es decisión de quien confirma un pago.
 */
import { normalizarCuit, type EntradaCuenta } from "../verificacion/cruce.js";
import { consultarMercadoPago, ErrorMercadoPago, importeACentavos } from "./cliente.js";
import { leer, texto } from "./lectura.js";

type Fetch = typeof fetch;
const POR_PAGINA = 100;
const MAXIMO_PAGINAS = 10;

/** Saca de un pago de Mercado Pago lo necesario para cruzar; null si no es una entrada aprobada a esta cuenta. */
export function entradaDesdePago(pago: unknown, miId: string): EntradaCuenta | null {
  if (texto(leer(pago, "collector_id")) !== miId) return null;
  if (texto(leer(pago, "payer.id")) === miId) return null; // la pagué yo: no es una entrada
  if (texto(leer(pago, "status")) !== "approved") return null;
  const mpPagoId = texto(leer(pago, "id"));
  const monto = importeACentavos(leer(pago, "transaction_amount"));
  const fechaTexto = texto(leer(pago, "date_approved")) ?? texto(leer(pago, "date_created"));
  const fecha = fechaTexto ? new Date(fechaTexto) : null;
  if (!mpPagoId || monto === null || monto <= 0n || !fecha || Number.isNaN(fecha.getTime())) return null;
  return {
    mpPagoId,
    e2eId: texto(leer(pago, "point_of_interaction.transaction_data.e2e_id")),
    montoCentavos: monto,
    fecha,
    cuitPagador: normalizarCuit(texto(leer(pago, "payer.identification.number"))),
  };
}

export async function idDeLaCuenta(clave: string, opciones: { fetch?: Fetch } = {}): Promise<string> {
  const id = texto(leer(await consultarMercadoPago(clave, "/users/me", opciones), "id"));
  if (!id) throw new ErrorMercadoPago("Mercado Pago no devolvió los datos de la cuenta.", "RESPUESTA_RARA");
  return id;
}

/** Busca las entradas aprobadas entre dos fechas (por fecha de creación del pago). */
export async function buscarEntradas(
  clave: string,
  desde: Date,
  hasta: Date,
  opciones: { fetch?: Fetch } = {},
): Promise<EntradaCuenta[]> {
  const miId = await idDeLaCuenta(clave, opciones);
  const entradas: EntradaCuenta[] = [];
  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
    const params = new URLSearchParams({
      sort: "date_created",
      criteria: "desc",
      range: "date_created",
      begin_date: desde.toISOString(),
      end_date: hasta.toISOString(),
      limit: String(POR_PAGINA),
      offset: String(pagina * POR_PAGINA),
    });
    const respuesta = await consultarMercadoPago(clave, `/v1/payments/search?${params.toString()}`, opciones);
    const resultados = leer(respuesta, "results");
    const pagos = Array.isArray(resultados) ? resultados : [];
    for (const p of pagos) {
      const e = entradaDesdePago(p, miId);
      if (e) entradas.push(e);
    }
    if (pagos.length < POR_PAGINA) break;
  }
  return entradas;
}
