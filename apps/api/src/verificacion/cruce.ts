/**
 * La regla que decide si un comprobante se confirma solo (docs/DISENO.md, "Verificación automática").
 *
 * Es una función pura: recibe lo que leyó la IA y los movimientos que entraron a la cuenta, y decide.
 * Ante cualquier duda devuelve REVISAR: la app nunca confirma algo que no pudo verificar.
 *
 * Confirma sola solo si:
 *  - el monto del movimiento coincide al centavo con el del comprobante (y con el esperado, si hay uno),
 *  - el movimiento no se usó antes para otro pago, y además
 *  - (a) el número de operación del comprobante es el del movimiento, o
 *  - (b) coincide el CUIT/CUIL de quien pagó, la fecha está a 3 días o menos y es el ÚNICO movimiento así.
 * Si en (a) el CUIT/CUIL o la fecha contradicen al comprobante, también va a revisar.
 */
import { formatearPesos } from "@3t/shared";

export const DIAS_DE_TOLERANCIA = 3;
const MS_TOLERANCIA = DIAS_DE_TOLERANCIA * 24 * 3600_000;

/** Lo que importa de un comprobante para cruzarlo (ya leído por la IA y validado). */
export interface DatosComprobante {
  montoCentavos: bigint | null;
  fecha: Date | null;
  cuitPagador: string | null;
  numeroOperacion: string | null;
}

/** Una entrada aprobada a la cuenta, tal como la devuelve Mercado Pago (ya normalizada). */
export interface EntradaCuenta {
  mpPagoId: string;
  e2eId: string | null;
  montoCentavos: bigint;
  fecha: Date;
  cuitPagador: string | null;
}

export type CodigoRevision =
  | "ILEGIBLE"
  | "MONTO_DISTINTO_AL_ESPERADO"
  | "NO_FIGURA"
  | "YA_USADO"
  | "CONTRADICE"
  | "VARIOS_CANDIDATOS"
  | "SIN_FORMA_DE_IDENTIFICAR";

export type Decision =
  | { resultado: "CONFIRMAR"; entrada: EntradaCuenta; por: "NUMERO_OPERACION" | "CUIT" }
  | { resultado: "REVISAR"; codigo: CodigoRevision; motivo: string; candidatos: EntradaCuenta[] };

/** Deja solo letras y números, en minúscula, para comparar números de operación escritos distinto. */
export const normalizarCodigo = (texto: string) => texto.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Un CUIT/CUIL válido tiene 11 dígitos; cualquier otra cosa no sirve para identificar. */
export function normalizarCuit(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const digitos = texto.replace(/\D/g, "");
  return digitos.length === 11 ? digitos : null;
}

const cerca = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) <= MS_TOLERANCIA;

function coincideNumero(numero: string, entrada: EntradaCuenta): boolean {
  const n = normalizarCodigo(numero);
  if (n.length < 6) return false; // un número tan corto podría coincidir de casualidad
  return n === normalizarCodigo(entrada.mpPagoId) || (entrada.e2eId !== null && n === normalizarCodigo(entrada.e2eId));
}

const revisar = (codigo: CodigoRevision, motivo: string, candidatos: EntradaCuenta[] = []): Decision => ({
  resultado: "REVISAR",
  codigo,
  motivo,
  candidatos,
});

export function decidir(
  comprobante: DatosComprobante,
  entradas: readonly EntradaCuenta[],
  yaUsados: ReadonlySet<string>,
  montoEsperadoCentavos: bigint | null = null,
): Decision {
  const monto = comprobante.montoCentavos;
  if (monto === null || monto <= 0n) return revisar("ILEGIBLE", "No se pudo leer el monto del comprobante.");
  if (montoEsperadoCentavos !== null && monto !== montoEsperadoCentavos) {
    return revisar(
      "MONTO_DISTINTO_AL_ESPERADO",
      `El comprobante es por ${formatearPesos(monto)} y lo que había que pagar es ${formatearPesos(montoEsperadoCentavos)}.`,
    );
  }

  const cuit = normalizarCuit(comprobante.cuitPagador);
  const numero = comprobante.numeroOperacion?.trim() || null;
  const mismoMonto = entradas.filter((e) => e.montoCentavos === monto);

  // (a) Por número de operación.
  if (numero) {
    const porNumero = mismoMonto.filter((e) => coincideNumero(numero, e));
    const usada = porNumero.find((e) => yaUsados.has(e.mpPagoId));
    if (usada) {
      return revisar("YA_USADO", "Ese número de operación ya se usó para confirmar otro pago.", [usada]);
    }
    if (porNumero.length === 1) {
      const entrada = porNumero[0] as EntradaCuenta;
      if (cuit && entrada.cuitPagador && cuit !== entrada.cuitPagador) {
        return revisar("CONTRADICE", "El número de operación coincide, pero el CUIT/CUIL de quien pagó es otro.", [entrada]);
      }
      if (comprobante.fecha && !cerca(comprobante.fecha, entrada.fecha)) {
        return revisar("CONTRADICE", "El número de operación coincide, pero la fecha del comprobante es otra.", [entrada]);
      }
      return { resultado: "CONFIRMAR", entrada, por: "NUMERO_OPERACION" };
    }
    if (porNumero.length > 1) return revisar("VARIOS_CANDIDATOS", "Hay más de un movimiento con ese número.", porNumero);
    // Si el número de otra operación coincide pero con otro monto, es una contradicción clara.
    const otroMonto = entradas.find((e) => coincideNumero(numero, e));
    if (otroMonto) {
      return revisar(
        "CONTRADICE",
        `El número de operación existe, pero ese movimiento es por ${formatearPesos(otroMonto.montoCentavos)} y el comprobante dice ${formatearPesos(monto)}.`,
        [otroMonto],
      );
    }
  }

  // (b) Por CUIT/CUIL + fecha cercana + único candidato.
  if (!cuit || !comprobante.fecha) {
    const parecidos = mismoMonto.filter((e) => !yaUsados.has(e.mpPagoId));
    if (parecidos.length === 0) {
      return revisar("NO_FIGURA", `Todavía no figura en la cuenta una transferencia de ${formatearPesos(monto)}.`);
    }
    return revisar(
      "SIN_FORMA_DE_IDENTIFICAR",
      "El número de operación no coincide con ninguna entrada y el comprobante no trae CUIT/CUIL o fecha legibles.",
      parecidos,
    );
  }
  const fecha = comprobante.fecha;
  const posibles = mismoMonto.filter((e) => e.cuitPagador === cuit && cerca(e.fecha, fecha));
  const libres = posibles.filter((e) => !yaUsados.has(e.mpPagoId));
  if (libres.length === 1) return { resultado: "CONFIRMAR", entrada: libres[0] as EntradaCuenta, por: "CUIT" };
  if (libres.length > 1) {
    return revisar("VARIOS_CANDIDATOS", "Esa persona hizo más de una transferencia por el mismo monto esos días.", libres);
  }
  if (posibles.length > 0) {
    return revisar("YA_USADO", "La transferencia de esa persona por ese monto ya se usó para otro pago.", posibles);
  }
  const deOtros = mismoMonto.filter((e) => cerca(e.fecha, fecha) && !yaUsados.has(e.mpPagoId));
  if (deOtros.length > 0) {
    return revisar(
      "CONTRADICE",
      `Hay entradas de ${formatearPesos(monto)} esos días, pero de otro CUIT/CUIL.`,
      deOtros,
    );
  }
  return revisar("NO_FIGURA", `Todavía no figura en la cuenta una transferencia de ${formatearPesos(monto)} de ese CUIT/CUIL.`);
}
