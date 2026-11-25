/**
 * Gastos: plata que sale para comprar algo, con el detalle producto por producto.
 * Cada gasto genera un asiento: la cuenta de donde salió la plata baja y suben los egresos por categoría.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { MONTO_MAXIMO_CENTAVOS, sumarCentavos } from "@3t/shared";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { archivos, cocinas, gastoItems, gastos, tickets } from "../db/esquema.js";
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

export const eliminarGastoSchema = z.discriminatedUnion("destino", [
  /** No se gastó o la devolvieron: la plata vuelve a la cuenta de donde salió. */
  z.object({ destino: z.literal("VUELVE") }),
  /** Se gastó igual: queda como un gasto "Otros" con el nombre que pone el dueño. */
  z.object({ destino: z.literal("SE_GASTO"), concepto: z.string().trim().min(3, "Poné en qué se gastó (por ejemplo, «Prueba de la app»).").max(120) }),
]);

/**
 * Eliminar un gasto (decisión del dueño, 25/11/2026). Solo el dueño.
 * El gasto, su detalle y su ticket se borran; la plata se reacomoda según lo que elija el dueño, así la caja cierra.
 * Un gasto de una cocina ya cerrada no se elimina suelto (se cambia eliminando el sábado entero).
 */
export async function eliminarGasto(db: BaseDeDatos, actor: ActorAdmin, gastoId: string, pedido: z.input<typeof eliminarGastoSchema> | null) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar un gasto");
  return db.transaction(async (tx) => {
    const [gasto] = await tx.select().from(gastos).where(eq(gastos.id, gastoId)).for("update");
    if (!gasto) throw noExiste("El gasto");
    if (gasto.cocinaId) {
      const [cocina] = await tx.select().from(cocinas).where(eq(cocinas.id, gasto.cocinaId)).for("update");
      if (cocina?.estado === "CERRADA") {
        throw new ErrorNegocio(409, "COCINA_CERRADA", "La cocina de ese sábado ya se cerró y rindió: para cambiarla hay que eliminar el sábado entero.");
      }
    }
    // Un gasto ya anulado no tiene plata: se borra sin preguntar.
    const datos = gasto.estado === "ANULADO" ? null : eliminarGastoSchema.parse(pedido ?? {});
    const items = await tx.select().from(gastoItems).where(eq(gastoItems.gastoId, gastoId));

    let reemplazoId: string | null = null;
    if (datos) {
      await anularAsiento(tx, actor, { asientoId: gasto.asientoId, motivo: datos.destino === "VUELVE" ? "Gasto eliminado: la plata vuelve" : `Gasto eliminado: pasa a «${datos.concepto}»` });
      if (datos.destino === "SE_GASTO") {
        const nuevo = await registrarGasto(tx, actor, {
          fecha: gasto.fecha,
          descripcion: datos.concepto,
          cuentaOrigenCodigo: gasto.cuentaOrigenCodigo,
          cocinaId: gasto.cocinaId ?? undefined,
          sabadoId: gasto.sabadoId ?? undefined,
          origenCarga: "MANUAL",
          items: [{ descripcion: datos.concepto, categoria: "OTROS", subtotalCentavos: gasto.totalCentavos }],
        });
        reemplazoId = nuevo.id;
      }
    }

    // Borrado (la base solo lo permite dentro de esta operación). El ticket y su foto también se van.
    const suyos = await tx.select().from(tickets).where(eq(tickets.gastoId, gastoId));
    if (suyos.length) {
      await tx.delete(tickets).where(eq(tickets.gastoId, gastoId));
      await tx.delete(archivos).where(inArray(archivos.id, suyos.map((t) => t.archivoId)));
    }
    await tx.execute(sql`select set_config('app.eliminando', ${`gasto:${gastoId}`}, true)`);
    await tx.delete(gastoItems).where(eq(gastoItems.gastoId, gastoId));
    await tx.delete(gastos).where(eq(gastos.id, gastoId));
    await tx.execute(sql`select set_config('app.eliminando', '', true)`);

    await registrarAuditoria(tx, actor, {
      accion: "GASTO_ELIMINADO",
      entidad: "gasto",
      entidadId: gastoId,
      antes: { gasto, items },
      despues: datos ? { plata: datos.destino, ...(datos.destino === "SE_GASTO" ? { concepto: datos.concepto, gastoNuevoId: reemplazoId } : {}) } : null,
    });
    return { reemplazoId };
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
