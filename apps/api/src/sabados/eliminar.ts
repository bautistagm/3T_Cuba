/**
 * Eliminar un sábado entero (decisión del dueño, 25/11/2026). Solo el dueño.
 *
 * Un sábado mueve plata por dos lados, y el dueño decide cada uno:
 * - Cobros a invitados: "DEVUELTOS" (cada cobro se anula: la plata sale de la caja) o "QUEDAN" (se anulan y la misma
 *   plata entra como Otro ingreso con el nombre que pone el dueño).
 * - La cocina (plata que se le pasó a la camada, sus gastos, devoluciones y cierre):
 *   "VOLVIO" (todo se anula: como si ese sábado no hubiera existido) o "SE_GASTO" (todo se anula y lo que la cocina
 *   le costó a la caja queda como un solo gasto Otros con el nombre que pone el dueño).
 * Después se borran el sábado, la cocina, sus movimientos, gastos, tickets y cobros. Los asientos de caja no se
 * borran nunca, así la caja siempre cierra.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import { codigoCuentaCocina } from "../cocina/cocina.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { archivos, asientosCaja, cocinas, cuentasCaja, gastoItems, gastos, movimientosCaja, movimientosCocina, pagos, sabados, tickets, transferenciasRecibidas } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { registrarGasto } from "../gastos/gastos.js";

const nombre = z.string().trim().min(3, "Poné un nombre (por ejemplo, «Prueba de la app»).").max(120);
export const eliminarSabadoSchema = z.object({
  cobros: z.discriminatedUnion("destino", [z.object({ destino: z.literal("DEVUELTOS") }), z.object({ destino: z.literal("QUEDAN"), concepto: nombre })]).optional(),
  cocina: z.discriminatedUnion("destino", [z.object({ destino: z.literal("VOLVIO") }), z.object({ destino: z.literal("SE_GASTO"), concepto: nombre })]).optional(),
});

async function datosDelSabado(db: Ejecutor, sabadoId: string) {
  const cobros = await db.select().from(pagos).where(eq(pagos.sabadoId, sabadoId));
  const [cocina] = await db.select().from(cocinas).where(eq(cocinas.sabadoId, sabadoId)).limit(1);
  const movimientos = cocina ? await db.select().from(movimientosCocina).where(eq(movimientosCocina.cocinaId, cocina.id)) : [];
  const gastosDelSabado = await db
    .select()
    .from(gastos)
    .where(cocina ? sql`${gastos.sabadoId} = ${sabadoId} OR ${gastos.cocinaId} = ${cocina.id}` : eq(gastos.sabadoId, sabadoId));
  const asientosCocina = [
    ...movimientos.filter((m) => m.estado === "CONFIRMADO").map((m) => m.asientoId),
    ...gastosDelSabado.filter((g) => g.estado === "CONFIRMADO").map((g) => g.asientoId),
  ];
  return { cobros, cocina: cocina ?? null, movimientos, gastos: gastosDelSabado, asientosCocina };
}

/** Lo que la cocina hizo con la plata, sumado por cuenta (sin contar asientos ya anulados). */
async function efectoPorCuenta(db: Ejecutor, asientoIds: string[]) {
  if (asientoIds.length === 0) return new Map<string, bigint>();
  const filas = await db
    .select({ codigo: cuentasCaja.codigo, monto: sql<string>`sum(${movimientosCaja.montoCentavos})::text` })
    .from(movimientosCaja)
    .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
    .where(inArray(movimientosCaja.asientoId, asientoIds))
    .groupBy(cuentasCaja.codigo);
  return new Map(filas.map((f) => [f.codigo, BigInt(f.monto)]));
}

/** Lo que la cocina le costó a la caja: lo que terminó en gastos o quedó en manos de la camada. */
function costoDeLaCocina(efecto: Map<string, bigint>, cuentaCocina: string | null) {
  let costo = 0n;
  for (const [codigo, monto] of efecto) if (codigo.startsWith("EGRESO:") || codigo === cuentaCocina) costo += monto;
  return costo;
}

/** Lo que se muestra antes de eliminar. */
export async function antesDeEliminarSabado(db: BaseDeDatos, actor: ActorAdmin, sabadoId: string) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar un sábado");
  const [sabado] = await db.select().from(sabados).where(eq(sabados.id, sabadoId)).limit(1);
  if (!sabado) throw noExiste("El sábado");
  const d = await datosDelSabado(db, sabadoId);
  const activos = d.cobros.filter((c) => c.estado === "CONFIRMADO");
  const efecto = await efectoPorCuenta(db, d.asientosCocina);
  const cuentaCocina = d.cocina ? codigoCuentaCocina(d.cocina.id) : null;
  return {
    fecha: sabado.fecha,
    cobros: activos.length,
    cobrosCentavos: activos.reduce((s, c) => s + c.montoCentavos, 0n),
    tieneCocina: d.cocina !== null,
    cocinaConPlata: d.asientosCocina.length > 0,
    /** Lo que se gastó o quedó en manos de la camada. */
    cocinaGastadoCentavos: costoDeLaCocina(efecto, cuentaCocina),
    /** Lo que tiene la camada todavía (cocina abierta). */
    enManosDeLaCamadaCentavos: cuentaCocina ? (efecto.get(cuentaCocina) ?? 0n) : 0n,
  };
}

export async function eliminarSabado(db: BaseDeDatos, actor: ActorAdmin, sabadoId: string, pedido: z.input<typeof eliminarSabadoSchema>) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar un sábado");
  const datos = eliminarSabadoSchema.parse(pedido);
  return db.transaction(async (tx) => {
    const [sabado] = await tx.select().from(sabados).where(eq(sabados.id, sabadoId)).for("update");
    if (!sabado) throw noExiste("El sábado");
    if (datos.cocina || datos.cobros) await tx.select().from(cocinas).where(eq(cocinas.sabadoId, sabadoId)).for("update");
    const d = await datosDelSabado(tx, sabadoId);
    const cobrosActivos = d.cobros.filter((c) => c.estado === "CONFIRMADO");
    if (cobrosActivos.length > 0 && !datos.cobros) {
      throw new ErrorNegocio(409, "SABADO_CON_COBROS", "Este sábado tiene cobros: elegí si los devolviste o si la plata queda en la caja.");
    }
    if (d.asientosCocina.length > 0 && !datos.cocina) {
      throw new ErrorNegocio(409, "SABADO_CON_COCINA", "La cocina de este sábado movió plata: elegí si volvió o si se gastó igual.");
    }

    // 1) Cobros a invitados.
    for (const cobro of cobrosActivos) {
      const queda = datos.cobros?.destino === "QUEDAN";
      await anularAsiento(tx, actor, { asientoId: cobro.asientoId, motivo: `Sábado ${sabado.fecha} eliminado: ${queda ? "pasa a otro ingreso" : "cobro devuelto"}` });
      let nuevoId: string | null = null;
      if (datos.cobros?.destino === "QUEDAN") {
        const concepto = datos.cobros.concepto;
        const cuenta = await cuentaDelCobro(tx, cobro.asientoId);
        const asientoId = await registrarAsiento(tx, actor, {
          fecha: cobro.fecha,
          descripcion: `Otro ingreso: ${concepto}`.slice(0, 200),
          origen: "PAGO",
          lineas: [
            { cuentaCodigo: cuenta, montoCentavos: cobro.montoCentavos },
            { cuentaCodigo: "INGRESO:OTROS", montoCentavos: -cobro.montoCentavos },
          ],
        });
        const [nuevo] = await tx
          .insert(pagos)
          .values({ origen: "OTRO", montoCentavos: cobro.montoCentavos, medio: cobro.medio, fecha: cobro.fecha, nota: concepto.slice(0, 300), recibidoPorAdminId: cobro.recibidoPorAdminId, registradoPorAdminId: actor.adminId, asientoId })
          .returning();
        nuevoId = nuevo?.id ?? null;
      }
      await tx
        .update(transferenciasRecibidas)
        .set(
          nuevoId
            ? { estado: "RESUELTA", resolucion: "OTRO_INGRESO", pagoId: nuevoId, resueltoPorAdminId: actor.adminId, resueltoEn: new Date() }
            : { estado: "RESUELTA", resolucion: "DEVUELTA", pagoId: null, nota: `Devuelta al eliminar el sábado ${sabado.fecha}`, resueltoPorAdminId: actor.adminId, resueltoEn: new Date() },
        )
        .where(eq(transferenciasRecibidas.pagoId, cobro.id));
    }
    // 2) Cocina: se anula todo lo que hizo; si "se gastó igual", lo que costó queda como un solo gasto.
    const cuentaCocina = d.cocina ? codigoCuentaCocina(d.cocina.id) : null;
    const efecto = await efectoPorCuenta(tx, d.asientosCocina);
    const costo = costoDeLaCocina(efecto, cuentaCocina);
    for (const asientoId of d.asientosCocina) {
      await anularAsiento(tx, actor, { asientoId, motivo: `Sábado ${sabado.fecha} eliminado` });
    }
    let gastoNuevoId: string | null = null;
    if (datos.cocina?.destino === "SE_GASTO" && costo > 0n) {
      const concepto = datos.cocina.concepto;
      // De dónde salió esa plata (normalmente, la cuenta del plantel).
      const origenes = [...efecto].filter(([codigo, monto]) => !codigo.startsWith("EGRESO:") && codigo !== cuentaCocina && monto !== 0n);
      const unico = origenes.length === 1 ? origenes[0] : undefined;
      if (unico && unico[1] === -costo) {
        const nuevo = await registrarGasto(tx, actor, {
          fecha: new Date(`${sabado.fecha}T15:00:00-03:00`),
          descripcion: concepto,
          cuentaOrigenCodigo: unico[0],
          origenCarga: "MANUAL",
          items: [{ descripcion: concepto, categoria: "OTROS", subtotalCentavos: costo }],
        });
        gastoNuevoId = nuevo.id;
      } else {
        await registrarAsiento(tx, actor, {
          fecha: new Date(`${sabado.fecha}T15:00:00-03:00`),
          descripcion: `Otro gasto: ${concepto}`.slice(0, 200),
          origen: "GASTO",
          lineas: [...origenes.map(([cuentaCodigo, montoCentavos]) => ({ cuentaCodigo, montoCentavos })), { cuentaCodigo: "EGRESO:OTROS", montoCentavos: costo }],
        });
      }
    }

    // 3) Borrado (la base solo lo permite dentro de esta operación).
    await tx.execute(sql`select set_config('app.eliminando', ${`sabado:${sabadoId}`}, true)`);
    const gastoIds = d.gastos.map((g) => g.id);
    if (gastoIds.length) {
      const suyos = await tx.select().from(tickets).where(inArray(tickets.gastoId, gastoIds));
      await tx.delete(tickets).where(inArray(tickets.gastoId, gastoIds));
      if (suyos.length) await tx.delete(archivos).where(inArray(archivos.id, suyos.map((t) => t.archivoId)));
      await tx.delete(gastoItems).where(inArray(gastoItems.gastoId, gastoIds));
      await tx.delete(gastos).where(inArray(gastos.id, gastoIds));
    }
    if (d.cocina) {
      const sueltos = await tx.select().from(tickets).where(and(eq(tickets.cocinaId, d.cocina.id), isNull(tickets.gastoId)));
      await tx.delete(tickets).where(eq(tickets.cocinaId, d.cocina.id));
      if (sueltos.length) await tx.delete(archivos).where(inArray(archivos.id, sueltos.map((t) => t.archivoId)));
      await tx.delete(movimientosCocina).where(eq(movimientosCocina.cocinaId, d.cocina.id));
      await tx.delete(cocinas).where(eq(cocinas.id, d.cocina.id));
    }
    if (d.cobros.length) {
      // Las transferencias que apuntaban a estos cobros ya se movieron arriba (o al anularlos, antes).
      await tx.delete(pagos).where(eq(pagos.sabadoId, sabadoId));
    }
    await tx.delete(sabados).where(eq(sabados.id, sabadoId));
    await tx.execute(sql`select set_config('app.eliminando', '', true)`);

    await registrarAuditoria(tx, actor, {
      accion: "SABADO_ELIMINADO",
      entidad: "sabado",
      entidadId: sabadoId,
      antes: { fecha: sabado.fecha, cobros: d.cobros.length, gastos: d.gastos.length, movimientosCocina: d.movimientos.length },
      despues: { cobros: datos.cobros ?? null, cocina: datos.cocina ?? null, costoCocinaCentavos: costo.toString(), gastoNuevoId },
    });
    return { gastoNuevoId };
  });
}

/** La cuenta a la que entró un cobro (la cuenta del plantel o el efectivo de un admin). */
async function cuentaDelCobro(tx: Transaccion, asientoId: string) {
  const [fila] = await tx
    .select({ codigo: cuentasCaja.codigo })
    .from(movimientosCaja)
    .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
    .innerJoin(asientosCaja, eq(asientosCaja.id, movimientosCaja.asientoId))
    .where(and(eq(movimientosCaja.asientoId, asientoId), sql`${movimientosCaja.montoCentavos} > 0`))
    .limit(1);
  if (!fila) throw new Error("No se encontró la cuenta del cobro");
  return fila.codigo;
}
