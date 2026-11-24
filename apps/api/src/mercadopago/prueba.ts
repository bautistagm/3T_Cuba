/**
 * Prueba de conexión con Mercado Pago, solo para el dueño.
 *
 * Sirve para ver, con una transferencia real de prueba, cómo aparece en la cuenta y qué datos trae
 * (número de operación, quién transfirió, etc.). Con eso se define cómo se cruzan los comprobantes.
 * No guarda nada: lo que lee se muestra y se descarta.
 */
import { consultarMercadoPago, ErrorMercadoPago, importeACentavos } from "./cliente.js";
import { leer, texto } from "./lectura.js";

type Fetch = typeof fetch;

/** Lugares del pago donde Mercado Pago podría traer el número de operación o el id de la transferencia. */
const POSIBLES_REFERENCIAS = [
  "transaction_details.transaction_id",
  "transaction_details.bank_transfer_id",
  "transaction_details.financial_institution",
  "point_of_interaction.type",
  "point_of_interaction.transaction_data.e2e_id",
  "point_of_interaction.transaction_data.transaction_id",
  "point_of_interaction.transaction_data.bank_transfer_id",
  "point_of_interaction.transaction_data.bank_info.origin_bank_id",
  "external_reference",
  "authorization_code",
  "description",
] as const;

/** Lugares donde podría venir quién transfirió. */
const POSIBLES_PAGADORES = [
  "payer.first_name",
  "payer.last_name",
  "payer.identification.type",
  "payer.identification.number",
  "point_of_interaction.transaction_data.bank_info.payer.long_name",
  "point_of_interaction.transaction_data.bank_info.payer.account_holder_name",
  "point_of_interaction.transaction_data.bank_info.payer.identification.number",
] as const;

export interface MovimientoDePrueba {
  id: string;
  fecha: string | null;
  montoCentavos: bigint | null;
  estado: string | null;
  tipoOperacion: string | null;
  medio: string | null;
  /** Datos que podrían servir para cruzar con el comprobante: dónde vienen y qué traen. */
  referencias: { campo: string; valor: string }[];
  pagador: { campo: string; valor: string }[];
}

export interface ResultadoPrueba {
  cuenta: { id: string; apodo: string | null };
  movimientos: MovimientoDePrueba[];
}

function presentes(pago: unknown, rutas: readonly string[]) {
  return rutas.flatMap((campo) => {
    const valor = texto(leer(pago, campo));
    return valor === null ? [] : [{ campo, valor }];
  });
}

/** Lee los últimos movimientos que ENTRARON a la cuenta (últimos 7 días), sin guardar nada. */
export async function probarConexion(clave: string | undefined, opciones: { fetch?: Fetch } = {}): Promise<ResultadoPrueba> {
  if (!clave) {
    throw new ErrorMercadoPago("Todavía no está cargada la clave de Mercado Pago (MP_ACCESS_TOKEN) en Render.", "SIN_CLAVE");
  }
  const yo = await consultarMercadoPago(clave, "/users/me", opciones);
  const miId = texto(leer(yo, "id"));
  if (!miId) throw new ErrorMercadoPago("Mercado Pago no devolvió los datos de la cuenta.", "RESPUESTA_RARA");

  const busqueda = await consultarMercadoPago(
    clave,
    "/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=NOW-7DAYS&end_date=NOW&limit=30",
    opciones,
  );
  const resultados = leer(busqueda, "results");
  const pagos = Array.isArray(resultados) ? resultados : [];

  const movimientos = pagos
    // Solo lo que entró: el que cobra es esta cuenta y no la pagó ella misma.
    .filter((p) => texto(leer(p, "collector_id")) === miId && texto(leer(p, "payer.id")) !== miId)
    .slice(0, 15)
    .map(
      (p): MovimientoDePrueba => ({
        id: texto(leer(p, "id")) ?? "?",
        fecha: texto(leer(p, "date_approved")) ?? texto(leer(p, "date_created")),
        montoCentavos: importeACentavos(leer(p, "transaction_amount")),
        estado: texto(leer(p, "status")),
        tipoOperacion: texto(leer(p, "operation_type")),
        medio: [texto(leer(p, "payment_type_id")), texto(leer(p, "payment_method_id"))].filter(Boolean).join(" / ") || null,
        referencias: presentes(p, POSIBLES_REFERENCIAS),
        pagador: presentes(p, POSIBLES_PAGADORES),
      }),
    );

  return { cuenta: { id: miId, apodo: texto(leer(yo, "nickname")) }, movimientos };
}
