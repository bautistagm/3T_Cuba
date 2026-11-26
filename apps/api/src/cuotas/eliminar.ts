/**
 * Editar y eliminar un mes de cuotas (decisiones del dueño, 26/11/2026). Solo el dueño.
 *
 * Eliminar: las cuotas de ese mes se borran. Si alguien ya la pagó, el dueño elige qué pasó con esa plata:
 * - "DEVUELTA": sale de la caja.
 * - "QUEDA": queda en la caja como Otro ingreso, con el nombre que pone el dueño.
 * Si un pago cancelaba ese mes y otros, los otros meses siguen pagados (se vuelve a registrar el pago por esa parte).
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Transaccion } from "../db/cliente.js";
import { cargos, periodosCuota } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { quitarCuotasDeSusPagos } from "../edicion/sueltos.js";
import { nombreDelMes } from "./cuotas.js";

export const eliminarMesSchema = z.object({
  plata: z
    .discriminatedUnion("destino", [
      z.object({ destino: z.literal("DEVUELTA") }),
      z.object({ destino: z.literal("QUEDA"), concepto: z.string().trim().min(3, "Poné un nombre (por ejemplo, «Prueba de la app»).").max(120) }),
    ])
    .optional(),
});

async function pagadas(db: BaseDeDatos | Transaccion, periodoId: string) {
  return db.select().from(cargos).where(and(eq(cargos.periodoId, periodoId), eq(cargos.estado, "PAGADO")));
}

export async function antesDeEliminarMes(db: BaseDeDatos, actor: ActorAdmin, periodoId: string) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar un mes");
  const [periodo] = await db.select().from(periodosCuota).where(eq(periodosCuota.id, periodoId)).limit(1);
  if (!periodo) throw noExiste("El mes");
  const lista = await pagadas(db, periodoId);
  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(cargos).where(eq(cargos.periodoId, periodoId));
  return {
    nombre: nombreDelMes(periodo.anio, periodo.mes),
    cuotas: total?.n ?? 0,
    pagaron: lista.length,
    cobradoCentavos: lista.reduce((s, c) => s + c.montoCentavos, 0n),
  };
}

export async function eliminarMes(db: BaseDeDatos, actor: ActorAdmin, periodoId: string, pedido: z.input<typeof eliminarMesSchema>) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar un mes");
  const datos = eliminarMesSchema.parse(pedido);
  return db.transaction(async (tx) => {
    const [periodo] = await tx.select().from(periodosCuota).where(eq(periodosCuota.id, periodoId)).for("update");
    if (!periodo) throw noExiste("El mes");
    const delMes = await pagadas(tx, periodoId);
    if (delMes.length > 0 && !datos.plata) {
      throw new ErrorNegocio(409, "MES_CON_PAGOS", "Ya hay jugadores que pagaron este mes: elegí si devolviste la plata o si queda en la caja.");
    }
    const nombre = nombreDelMes(periodo.anio, periodo.mes);
    const todas = await tx.select({ id: cargos.id }).from(cargos).where(eq(cargos.periodoId, periodoId));
    const pagosTocados = new Set(delMes.map((c) => c.pagoId));
    await quitarCuotasDeSusPagos(tx, actor, todas.map((c) => c.id), datos.plata, `Se eliminó el mes ${nombre}`);
    const pagoIds = [...pagosTocados];

    // 5) Se borran las cuotas y el mes.
    const [cantidad] = await tx.select({ n: sql<number>`count(*)::int` }).from(cargos).where(eq(cargos.periodoId, periodoId));
    await tx.execute(sql`select set_config('app.eliminando', ${`mes:${periodoId}`}, true)`);
    await tx.delete(cargos).where(eq(cargos.periodoId, periodoId));
    await tx.delete(periodosCuota).where(eq(periodosCuota.id, periodoId));
    await tx.execute(sql`select set_config('app.eliminando', '', true)`);

    await registrarAuditoria(tx, actor, {
      accion: "MES_ELIMINADO",
      entidad: "periodos_cuota",
      entidadId: periodoId,
      antes: { anio: periodo.anio, mes: periodo.mes, montoCentavos: periodo.montoCentavos.toString(), cuotas: cantidad?.n ?? 0, pagaron: delMes.length },
      despues: datos.plata ?? null,
    });
    return { pagos: pagoIds.length };
  });
}

export const editarMesSchema = z.object({
  montoCentavos: z.coerce.bigint().positive("El monto tiene que ser mayor a cero."),
  nota: z.string().trim().max(200).optional(),
});

/**
 * Editar un mes: monto y nota. Si ya hay pagos, el monto nuevo se aplica solo a las cuotas pendientes que tenían
 * el monto del mes; las pagadas quedan como están.
 */
export async function editarMes(db: BaseDeDatos, actor: ActorAdmin, periodoId: string, pedido: z.input<typeof editarMesSchema>) {
  if (actor.rol !== "DUENO") throw soloDueno("editar un mes");
  const datos = editarMesSchema.parse(pedido);
  return db.transaction(async (tx) => {
    const [periodo] = await tx.select().from(periodosCuota).where(eq(periodosCuota.id, periodoId)).for("update");
    if (!periodo) throw noExiste("El mes");
    await tx.update(periodosCuota).set({ montoCentavos: datos.montoCentavos, nota: datos.nota?.trim() || null }).where(eq(periodosCuota.id, periodoId));
    const cambiadas = await tx
      .update(cargos)
      .set({ montoCentavos: datos.montoCentavos })
      .where(and(eq(cargos.periodoId, periodoId), eq(cargos.estado, "PENDIENTE"), eq(cargos.montoCentavos, periodo.montoCentavos)))
      .returning({ id: cargos.id });
    await registrarAuditoria(tx, actor, {
      accion: "MES_EDITADO",
      entidad: "periodos_cuota",
      entidadId: periodoId,
      antes: { montoCentavos: periodo.montoCentavos.toString(), nota: periodo.nota },
      despues: { montoCentavos: datos.montoCentavos.toString(), nota: datos.nota ?? null, cuotasCambiadas: cambiadas.length },
    });
    return { cuotasCambiadas: cambiadas.length };
  });
}

