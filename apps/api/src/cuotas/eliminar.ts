/**
 * Editar y eliminar un mes de cuotas (decisiones del dueño, 26/11/2026). Solo el dueño.
 *
 * Eliminar: las cuotas de ese mes se borran. Si alguien ya la pagó, el dueño elige qué pasó con esa plata:
 * - "DEVUELTA": sale de la caja.
 * - "QUEDA": queda en la caja como Otro ingreso, con el nombre que pone el dueño.
 * Si un pago cancelaba ese mes y otros, los otros meses siguen pagados (se vuelve a registrar el pago por esa parte).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Transaccion } from "../db/cliente.js";
import { cargos, cuentasCaja, movimientosCaja, pagos, periodosCuota, transferenciasRecibidas } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { nombreDelMes, registrarPagoDeCuotas } from "./cuotas.js";

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

/** La cuenta donde entró un pago (la del plantel o el efectivo de un admin). */
async function cuentaDelPago(tx: Transaccion, asientoId: string) {
  const [fila] = await tx
    .select({ codigo: cuentasCaja.codigo })
    .from(movimientosCaja)
    .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
    .where(and(eq(movimientosCaja.asientoId, asientoId), sql`${movimientosCaja.montoCentavos} > 0`))
    .limit(1);
  if (!fila) throw new Error("No se encontró la cuenta del pago");
  return fila.codigo;
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
    const pagoIds = [...new Set(delMes.map((c) => c.pagoId as string))];

    for (const pagoId of pagoIds) {
      const [pago] = await tx.select().from(pagos).where(eq(pagos.id, pagoId)).for("update");
      if (!pago || pago.estado !== "CONFIRMADO") continue;
      const cuenta = await cuentaDelPago(tx, pago.asientoId);
      const suyas = await tx
        .select({ cargo: cargos, anio: periodosCuota.anio, mes: periodosCuota.mes })
        .from(cargos)
        .innerJoin(periodosCuota, eq(periodosCuota.id, cargos.periodoId))
        .where(eq(cargos.pagoId, pagoId))
        .orderBy(asc(periodosCuota.anio), asc(periodosCuota.mes));
      const deEsteMes = suyas.filter((s) => s.cargo.periodoId === periodoId).reduce((s, x) => s + x.cargo.montoCentavos, 0n);
      const otras = suyas.filter((s) => s.cargo.periodoId !== periodoId);

      // 1) Se anula el pago y sus cuotas vuelven a pendientes.
      const motivo = `Se eliminó el mes ${nombre}`;
      const anulacionAsientoId = await anularAsiento(tx, actor, { asientoId: pago.asientoId, motivo });
      await tx.update(cargos).set({ estado: "PENDIENTE", pagoId: null }).where(eq(cargos.pagoId, pagoId));
      await tx.update(pagos).set({ estado: "ANULADO", anuladoEn: new Date(), anuladoPorAdminId: actor.adminId, motivoAnulacion: motivo, anulacionAsientoId }).where(eq(pagos.id, pagoId));

      // 2) Los otros meses que pagaba siguen pagados.
      let nuevoCuotas: string | null = null;
      if (otras.length > 0 && pago.jugadorId) {
        const nuevo = await registrarPagoDeCuotas(tx, actor, {
          jugadorId: pago.jugadorId,
          cuotas: otras.map((o) => ({ ...o.cargo, estado: "PENDIENTE" as const, pagoId: null, anio: o.anio, mes: o.mes })),
          medio: pago.medio === "EFECTIVO" ? "EFECTIVO" : "TRANSFERENCIA",
          fecha: pago.fecha,
          ...(pago.recibidoPorAdminId ? { recibidoPorAdminId: pago.recibidoPorAdminId } : {}),
          ...(pago.nota ? { nota: pago.nota } : {}),
        });
        nuevoCuotas = nuevo.id;
      }

      // 3) La parte de este mes: se devolvió, o queda como otro ingreso.
      let nuevoOtro: string | null = null;
      if (datos.plata?.destino === "QUEDA" && deEsteMes > 0n) {
        const concepto = datos.plata.concepto;
        const asientoId = await registrarAsiento(tx, actor, {
          fecha: pago.fecha,
          descripcion: `Otro ingreso: ${concepto}`.slice(0, 200),
          origen: "PAGO",
          lineas: [
            { cuentaCodigo: cuenta, montoCentavos: deEsteMes },
            { cuentaCodigo: "INGRESO:OTROS", montoCentavos: -deEsteMes },
          ],
        });
        const [otro] = await tx
          .insert(pagos)
          .values({ origen: "OTRO", montoCentavos: deEsteMes, medio: pago.medio, fecha: pago.fecha, nota: concepto.slice(0, 300), recibidoPorAdminId: pago.recibidoPorAdminId, registradoPorAdminId: actor.adminId, asientoId })
          .returning();
        nuevoOtro = otro?.id ?? null;
      }

      // 4) La transferencia que había confirmado ese pago apunta a lo que quedó.
      const ahora = new Date();
      if (nuevoCuotas) {
        await tx.update(transferenciasRecibidas).set({ pagoId: nuevoCuotas }).where(eq(transferenciasRecibidas.pagoId, pagoId));
      } else if (nuevoOtro) {
        await tx
          .update(transferenciasRecibidas)
          .set({ estado: "RESUELTA", resolucion: "OTRO_INGRESO", pagoId: nuevoOtro, resueltoPorAdminId: actor.adminId, resueltoEn: ahora })
          .where(eq(transferenciasRecibidas.pagoId, pagoId));
      } else {
        await tx
          .update(transferenciasRecibidas)
          .set({ estado: "RESUELTA", resolucion: "DEVUELTA", pagoId: null, nota: `Devuelta al eliminar el mes ${nombre}`, resueltoPorAdminId: actor.adminId, resueltoEn: ahora })
          .where(eq(transferenciasRecibidas.pagoId, pagoId));
      }
    }

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

