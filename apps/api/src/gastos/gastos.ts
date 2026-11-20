/**
 * Gastos: plata que sale para comprar algo, con el detalle producto por producto.
 * Cada gasto genera un asiento: la cuenta de donde salió la plata baja y suben los egresos por categoría.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { MONTO_MAXIMO_CENTAVOS, sumarCentavos } from "@3t/shared";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { cocinas, gastoItems, gastos } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";

export const CATEGORIAS = ["CARNE", "BEBIDAS", "INSUMOS", "OTROS"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export interface ItemGasto {
  descripcion: string;
  cantidad?: string | undefined;
  categoria: Categoria;
  subtotalCentavos: bigint;
}

export interface DatosGasto {
  fecha: Date;
  proveedor?: string | undefined;
  descripcion?: string | undefined;
  cuentaOrigenCodigo: string;
  cocinaId?: string | undefined;
  sabadoId?: string | undefined;
  origenCarga: "IA" | "MANUAL";
  items: readonly ItemGasto[];
}

function validarItems(items: readonly ItemGasto[]): void {
  if (items.length === 0) throw new ErrorNegocio(400, "SIN_PRODUCTOS", "El gasto tiene que tener al menos un producto.");
  if (items.length > 100) throw new ErrorNegocio(400, "DEMASIADOS_PRODUCTOS", "Un gasto puede tener hasta 100 productos.");
  for (const item of items) {
    if (!item.descripcion.trim()) throw new ErrorNegocio(400, "PRODUCTO_SIN_NOMBRE", "Cada producto necesita una descripción.");
    if (!CATEGORIAS.includes(item.categoria)) throw new ErrorNegocio(400, "CATEGORIA_INVALIDA", "Categoría inválida.");
    if (typeof item.subtotalCentavos !== "bigint" || item.subtotalCentavos <= 0n || item.subtotalCentavos > MONTO_MAXIMO_CENTAVOS) {
      throw new ErrorNegocio(400, "MONTO_INVALIDO", `El importe de "${item.descripcion}" no es válido.`);
    }
  }
}

/** Registra un gasto dentro de una transacción ya abierta. El que llama decide de qué cuenta sale. */
export async function registrarGasto(tx: Transaccion, actor: Actor, datos: DatosGasto) {
  validarItems(datos.items);
  const total = sumarCentavos(datos.items.map((i) => i.subtotalCentavos));
  if (total > MONTO_MAXIMO_CENTAVOS) throw new ErrorNegocio(400, "MONTO_INVALIDO", "El total supera el máximo permitido.");

  const porCategoria = new Map<Categoria, bigint>();
  for (const item of datos.items) porCategoria.set(item.categoria, (porCategoria.get(item.categoria) ?? 0n) + item.subtotalCentavos);

  const proveedor = datos.proveedor?.trim().slice(0, 120) || null;
  const descripcion =
    datos.descripcion?.trim().slice(0, 200) ||
    (proveedor ? `Compra en ${proveedor}` : datos.items.map((i) => i.descripcion.trim()).join(", ").slice(0, 200));

  const asientoId = await registrarAsiento(tx, actor, {
    fecha: datos.fecha,
    descripcion: `Gasto: ${descripcion}`,
    origen: "GASTO",
    lineas: [
      ...[...porCategoria].map(([categoria, monto]) => ({ cuentaCodigo: `EGRESO:${categoria}`, montoCentavos: monto })),
      { cuentaCodigo: datos.cuentaOrigenCodigo, montoCentavos: -total },
    ],
  });

  const [gasto] = await tx
    .insert(gastos)
    .values({
      fecha: datos.fecha,
      proveedor,
      descripcion,
      totalCentavos: total,
      cuentaOrigenCodigo: datos.cuentaOrigenCodigo,
      cocinaId: datos.cocinaId ?? null,
      sabadoId: datos.sabadoId ?? null,
      origenCarga: datos.origenCarga,
      registradoPorAdminId: actor.tipo === "ADMIN" ? actor.adminId : null,
      asientoId,
    })
    .returning();
  if (!gasto) throw new Error("No se pudo registrar el gasto");
  const items = await tx
    .insert(gastoItems)
    .values(
      datos.items.map((i) => ({
        gastoId: gasto.id,
        descripcion: i.descripcion.trim().slice(0, 200),
        cantidad: i.cantidad?.trim().slice(0, 40) || null,
        categoria: i.categoria,
        subtotalCentavos: i.subtotalCentavos,
      })),
    )
    .returning();

  await registrarAuditoria(tx, actor, { accion: "GASTO_REGISTRADO", entidad: "gasto", entidadId: gasto.id, despues: { gasto, items } });
  return { ...gasto, items };
}

/** Solo el dueño anula un gasto. Si es de una cocina, la cocina tiene que seguir abierta. */
export async function anularGasto(db: BaseDeDatos, actor: ActorAdmin, gastoId: string, motivo: string) {
  if (actor.rol !== "DUENO") throw soloDueno("anular un gasto");
  return db.transaction(async (tx) => {
    const [gasto] = await tx.select().from(gastos).where(eq(gastos.id, gastoId)).for("update");
    if (!gasto) throw noExiste("El gasto");
    if (gasto.estado === "ANULADO") throw new ErrorNegocio(409, "YA_ANULADO", "Este gasto ya estaba anulado.");
    if (gasto.cocinaId) {
      const [cocina] = await tx.select().from(cocinas).where(eq(cocinas.id, gasto.cocinaId)).for("update");
      if (cocina?.estado === "CERRADA") {
        throw new ErrorNegocio(409, "COCINA_CERRADA", "La cocina de ese sábado ya se cerró y rindió: sus gastos no se pueden anular.");
      }
    }
    const anulacionAsientoId = await anularAsiento(tx, actor, { asientoId: gasto.asientoId, motivo });
    const [despues] = await tx
      .update(gastos)
      .set({ estado: "ANULADO", anuladoEn: new Date(), anuladoPorAdminId: actor.adminId, motivoAnulacion: motivo.trim(), anulacionAsientoId })
      .where(eq(gastos.id, gastoId))
      .returning();
    await registrarAuditoria(tx, actor, { accion: "GASTO_ANULADO", entidad: "gasto", entidadId: gastoId, antes: gasto, despues });
    return despues;
  });
}

/** Gastos con su detalle. */
export async function gastosConItems(db: Ejecutor, filtro: { cocinaId: string }) {
  const lista = await db.select().from(gastos).where(eq(gastos.cocinaId, filtro.cocinaId)).orderBy(asc(gastos.fecha));
  if (lista.length === 0) return [];
  const items = await db
    .select()
    .from(gastoItems)
    .where(inArray(gastoItems.gastoId, lista.map((g) => g.id)));
  return lista.map((g) => ({ ...g, items: items.filter((i) => i.gastoId === g.id) }));
}
