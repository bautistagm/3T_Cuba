/**
 * Eliminar una fiesta (decisión del dueño, 24/11/2026). Solo el dueño.
 *
 * - Sin plata: se borra todo (fiesta, tipos, tandas, compras sin pagar, entradas y emails pendientes).
 * - Con plata: el dueño elige qué pasó con esa plata, y recién ahí se borra:
 *   - "DEVUELTA": cada pago se anula (asiento espejo): la plata sale de la caja.
 *   - "QUEDA": cada pago se anula y la misma plata entra como "Otro ingreso" con el nombre que pone el dueño.
 *   Los pagos anulados y los movimientos de caja quedan (la plata nunca se borra), así la caja siempre cierra.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Transaccion } from "../db/cliente.js";
import { comprasEntradas, entradas, fiestas, notificaciones, pagos, tandas, tiposEntrada, transferenciasRecibidas } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";

export const eliminarFiestaSchema = z.object({
  plata: z
    .discriminatedUnion("destino", [
      z.object({ destino: z.literal("DEVUELTA") }),
      z.object({ destino: z.literal("QUEDA"), concepto: z.string().trim().min(3, "Poné de qué es el ingreso (por ejemplo, «Prueba de la app»).").max(120) }),
    ])
    .optional(),
});

async function pagosDeLaFiesta(tx: Transaccion | BaseDeDatos, fiestaId: string) {
  return tx
    .select({ pago: pagos })
    .from(comprasEntradas)
    .innerJoin(pagos, eq(pagos.id, comprasEntradas.pagoId))
    .where(and(eq(comprasEntradas.fiestaId, fiestaId), eq(pagos.estado, "CONFIRMADO")))
    .then((filas) => filas.map((f) => f.pago));
}

/** Lo que se muestra antes de eliminar: si hay plata y cuánta. */
export async function antesDeEliminarFiesta(db: BaseDeDatos, actor: ActorAdmin, fiestaId: string) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar fiestas");
  const [fiesta] = await db.select().from(fiestas).where(eq(fiestas.id, fiestaId)).limit(1);
  if (!fiesta) throw noExiste("La fiesta");
  const conPlata = await pagosDeLaFiesta(db, fiestaId);
  const [entradasCount] = await db.select({ n: sql<number>`count(*)::int` }).from(entradas).where(eq(entradas.fiestaId, fiestaId));
  return {
    nombre: fiesta.nombre,
    entradas: entradasCount?.n ?? 0,
    pagos: conPlata.length,
    totalCentavos: conPlata.reduce((s, p) => s + p.montoCentavos, 0n),
  };
}

export async function eliminarFiesta(db: BaseDeDatos, actor: ActorAdmin, fiestaId: string, pedido: z.input<typeof eliminarFiestaSchema>) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar fiestas");
  const datos = eliminarFiestaSchema.parse(pedido);
  return db.transaction(async (tx) => {
    const [fiesta] = await tx.select().from(fiestas).where(eq(fiestas.id, fiestaId)).for("update");
    if (!fiesta) throw noExiste("La fiesta");
    const conPlata = await pagosDeLaFiesta(tx, fiestaId);
    const total = conPlata.reduce((s, p) => s + p.montoCentavos, 0n);
    if (conPlata.length > 0 && !datos.plata) {
      throw new ErrorNegocio(409, "FIESTA_CON_PLATA", "Esta fiesta tiene plata cobrada: elegí si la devolviste o si queda en la caja.");
    }

    for (const pago of conPlata) {
      const motivo = datos.plata?.destino === "QUEDA" ? `Fiesta eliminada (${fiesta.nombre}): pasa a otro ingreso` : `Fiesta eliminada (${fiesta.nombre}): plata devuelta`;
      const anulacionAsientoId = await anularAsiento(tx, actor, { asientoId: pago.asientoId, motivo });
      await tx
        .update(pagos)
        .set({ estado: "ANULADO", anuladoEn: new Date(), anuladoPorAdminId: actor.adminId, motivoAnulacion: motivo, anulacionAsientoId })
        .where(eq(pagos.id, pago.id));

      if (datos.plata?.destino === "QUEDA") {
        const concepto = datos.plata.concepto;
        const asientoId = await registrarAsiento(tx, actor, {
          fecha: pago.fecha,
          descripcion: `Otro ingreso: ${concepto}`.slice(0, 200),
          origen: "PAGO",
          lineas: [
            { cuentaCodigo: "CUENTA", montoCentavos: pago.montoCentavos },
            { cuentaCodigo: "INGRESO:OTROS", montoCentavos: -pago.montoCentavos },
          ],
        });
        const [nuevo] = await tx
          .insert(pagos)
          .values({ origen: "OTRO", montoCentavos: pago.montoCentavos, medio: pago.medio, fecha: pago.fecha, nota: concepto.slice(0, 300), recibidoPorAdminId: pago.recibidoPorAdminId, registradoPorAdminId: actor.adminId, asientoId })
          .returning();
        await tx
          .update(transferenciasRecibidas)
          .set({ estado: "RESUELTA", resolucion: "OTRO_INGRESO", pagoId: nuevo?.id ?? null, nota: concepto.slice(0, 300), resueltoPorAdminId: actor.adminId, resueltoEn: new Date() })
          .where(eq(transferenciasRecibidas.pagoId, pago.id));
      } else {
        await tx
          .update(transferenciasRecibidas)
          .set({ estado: "RESUELTA", resolucion: "DEVUELTA", pagoId: null, nota: `Devuelta al eliminar la fiesta ${fiesta.nombre}`.slice(0, 300), resueltoPorAdminId: actor.adminId, resueltoEn: new Date() })
          .where(eq(transferenciasRecibidas.pagoId, pago.id));
      }
    }

    // Borrado completo (la base solo lo permite dentro de esta operación).
    await tx.execute(sql`select set_config('app.eliminando_fiesta', ${fiestaId}, true)`);
    const compras = await tx.select({ id: comprasEntradas.id }).from(comprasEntradas).where(eq(comprasEntradas.fiestaId, fiestaId));
    const tipos = await tx.select({ id: tiposEntrada.id }).from(tiposEntrada).where(eq(tiposEntrada.fiestaId, fiestaId));
    const [cantidad] = await tx.select({ n: sql<number>`count(*)::int` }).from(entradas).where(eq(entradas.fiestaId, fiestaId));
    await tx.delete(entradas).where(eq(entradas.fiestaId, fiestaId));
    if (compras.length) await tx.delete(notificaciones).where(inArray(notificaciones.compraId, compras.map((c) => c.id)));
    await tx.delete(comprasEntradas).where(eq(comprasEntradas.fiestaId, fiestaId));
    if (tipos.length) await tx.delete(tandas).where(inArray(tandas.tipoId, tipos.map((t) => t.id)));
    await tx.delete(tiposEntrada).where(eq(tiposEntrada.fiestaId, fiestaId));
    await tx.delete(fiestas).where(eq(fiestas.id, fiestaId));
    await tx.execute(sql`select set_config('app.eliminando_fiesta', '', true)`);

    // La auditoría guarda qué se eliminó, sin datos personales.
    await registrarAuditoria(tx, actor, {
      accion: "FIESTA_ELIMINADA",
      entidad: "fiestas",
      entidadId: fiestaId,
      antes: { nombre: fiesta.nombre, fechaHora: fiesta.fechaHora.toISOString(), entradas: cantidad?.n ?? 0, pagos: conPlata.length, totalCentavos: total.toString() },
      despues: datos.plata ? { plata: datos.plata.destino, ...(datos.plata.destino === "QUEDA" ? { concepto: datos.plata.concepto } : {}) } : null,
    });
    return { pagos: conPlata.length, totalCentavos: total };
  });
}
