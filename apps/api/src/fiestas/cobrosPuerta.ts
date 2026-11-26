/**
 * Cobrar en efectivo en la puerta de una fiesta (decisión del dueño, 26/11/2026).
 *
 * - Desde el link de la puerta (sin usuario), quien cobra elige el tipo, la cantidad de personas y escribe el monto.
 * - La plata queda a cargo de quien cobró (el nombre que puso en el link), en la cuenta "Efectivo en la puerta" de la
 *   fiesta. No se piden datos del invitado.
 * - Cuando se la entrega a un admin (o al dueño), ese admin toca "Recibí" y pasa a su efectivo.
 * - Anda sin señal: cada cobro trae un identificador del celular, así un reintento no se cuenta dos veces.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { cuentasCaja, fiestas, tiposEntrada, ventasPuerta } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";

export const codigoCuentaPuerta = (fiestaId: string) => `PUERTA:${fiestaId}`;
const MAXIMO_CENTAVOS = 100_000_000n; // $1.000.000 por cobro

async function asegurarCuenta(tx: Transaccion, fiesta: { id: string; nombre: string }) {
  await tx
    .insert(cuentasCaja)
    .values({ codigo: codigoCuentaPuerta(fiesta.id), nombre: `Efectivo en la puerta (${fiesta.nombre})`.slice(0, 120), tipo: "ACTIVO" })
    .onConflictDoNothing({ target: cuentasCaja.codigo });
}

export const ventasPuertaSchema = z.object({
  ventas: z
    .array(
      z.object({
        id: z.string().uuid(),
        tipoId: z.string().uuid(),
        cantidad: z.number().int().min(1, "Al menos una persona.").max(50),
        montoCentavos: z.coerce.bigint().positive("El monto tiene que ser mayor a cero."),
        por: z.string().trim().min(2, "Escribí tu nombre.").max(40),
        en: z.coerce.date(),
      }),
    )
    .min(1)
    .max(100),
});

/** Registra cobros hechos en la puerta. Si un cobro ya estaba (reintento), no hace nada. */
export async function registrarVentasPuerta(db: BaseDeDatos, actor: Actor, tokenPuerta: string, pedido: z.input<typeof ventasPuertaSchema>, ahora = new Date()) {
  const datos = ventasPuertaSchema.parse(pedido);
  const [fiesta] = await db.select().from(fiestas).where(eq(fiestas.tokenPuerta, tokenPuerta)).limit(1);
  if (!fiesta) throw new ErrorNegocio(404, "LINK_INVALIDO", "Este link de puerta no existe o lo cambiaron. Pedile el nuevo al organizador.");
  const tipos = await db.select().from(tiposEntrada).where(eq(tiposEntrada.fiestaId, fiesta.id));
  const listos: string[] = [];
  for (const v of datos.ventas) {
    const tipo = tipos.find((t) => t.id === v.tipoId);
    if (!tipo) throw new ErrorNegocio(400, "TIPO_INVALIDO", "Ese tipo de entrada no es de esta fiesta.");
    if (v.montoCentavos > MAXIMO_CENTAVOS) throw new ErrorNegocio(400, "MONTO_INVALIDO", "El monto es demasiado grande.");
    // Si no tenía señal, la hora es la del celular (nunca en el futuro ni de más de 2 días atrás).
    const en = v.en > ahora || v.en.getTime() < ahora.getTime() - 2 * 86_400_000 ? ahora : v.en;
    await db.transaction(async (tx) => {
      // Si dos pedidos traen el mismo cobro a la vez (reintentos), uno espera al otro.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`venta_puerta:${v.id}`}))`);
      const [ya] = await tx.select({ id: ventasPuerta.id }).from(ventasPuerta).where(eq(ventasPuerta.id, v.id)).limit(1);
      if (ya) return;
      await asegurarCuenta(tx, fiesta);
      const asientoId = await registrarAsiento(tx, actor, {
        fecha: en,
        descripcion: `Puerta ${fiesta.nombre}: ${v.cantidad} ${tipo.nombre} (cobró ${v.por})`.slice(0, 200),
        origen: "PAGO",
        lineas: [
          { cuentaCodigo: codigoCuentaPuerta(fiesta.id), montoCentavos: v.montoCentavos },
          { cuentaCodigo: "INGRESO:FIESTAS", montoCentavos: -v.montoCentavos },
        ],
      });
      await tx.insert(ventasPuerta).values({ id: v.id, fiestaId: fiesta.id, tipoId: tipo.id, cantidad: v.cantidad, montoCentavos: v.montoCentavos, cobradoPor: v.por, cobradoEn: en, asientoId });
      await registrarAuditoria(tx, actor, {
        accion: "COBRO_PUERTA",
        entidad: "ventas_puerta",
        entidadId: v.id,
        despues: { fiestaId: fiesta.id, tipo: tipo.nombre, cantidad: v.cantidad, montoCentavos: v.montoCentavos.toString(), por: v.por },
      });
    });
    listos.push(v.id);
  }
  return { listos };
}

/** Los cobros en la puerta de una fiesta, y cuánto tiene cada uno para entregar. */
export async function cobrosDePuerta(db: Ejecutor, fiestaId: string) {
  const lista = await db.select().from(ventasPuerta).where(eq(ventasPuerta.fiestaId, fiestaId)).orderBy(asc(ventasPuerta.cobradoEn));
  const porPersona = new Map<string, { centavos: bigint; cobros: number }>();
  for (const v of lista.filter((x) => x.estado === "A_RENDIR")) {
    const p = porPersona.get(v.cobradoPor) ?? { centavos: 0n, cobros: 0 };
    porPersona.set(v.cobradoPor, { centavos: p.centavos + v.montoCentavos, cobros: p.cobros + 1 });
  }
  return {
    ventas: lista.map((v) => ({
      id: v.id,
      tipoId: v.tipoId,
      cantidad: v.cantidad,
      montoCentavos: v.montoCentavos,
      cobradoPor: v.cobradoPor,
      cobradoEn: v.cobradoEn.toISOString(),
      estado: v.estado,
      rendidaEn: v.rendidaEn?.toISOString() ?? null,
    })),
    aRendir: [...porPersona].map(([nombre, x]) => ({ nombre, centavos: x.centavos, cobros: x.cobros })),
  };
}

/** Un admin (o el dueño) recibe la plata que juntó alguien en la puerta: pasa a su efectivo. */
export async function recibirPlataDePuerta(db: BaseDeDatos, actor: ActorAdmin, fiestaId: string, cobradoPor: string) {
  return db.transaction(async (tx) => {
    const [fiesta] = await tx.select().from(fiestas).where(eq(fiestas.id, fiestaId)).for("update");
    if (!fiesta) throw noExiste("La fiesta");
    const pendientes = await tx
      .select()
      .from(ventasPuerta)
      .where(and(eq(ventasPuerta.fiestaId, fiestaId), eq(ventasPuerta.cobradoPor, cobradoPor), eq(ventasPuerta.estado, "A_RENDIR")))
      .for("update");
    if (pendientes.length === 0) throw new ErrorNegocio(409, "NADA_PARA_RECIBIR", `${cobradoPor} no tiene plata de la puerta para entregar.`);
    const total = pendientes.reduce((s, v) => s + v.montoCentavos, 0n);
    const asientoId = await registrarAsiento(tx, actor, {
      fecha: new Date(),
      descripcion: `Recibí de ${cobradoPor} la plata de la puerta (${fiesta.nombre})`.slice(0, 200),
      origen: "RENDICION",
      lineas: [
        { cuentaCodigo: codigoEfectivo(actor.adminId), montoCentavos: total },
        { cuentaCodigo: codigoCuentaPuerta(fiestaId), montoCentavos: -total },
      ],
    });
    const ahora = new Date();
    await tx
      .update(ventasPuerta)
      .set({ estado: "RENDIDA", rendidaEn: ahora, rendidaAAdminId: actor.adminId, rendicionAsientoId: asientoId })
      .where(inArray(ventasPuerta.id, pendientes.map((v) => v.id)));
    await registrarAuditoria(tx, actor, { accion: "PUERTA_RECIBIDA", entidad: "fiestas", entidadId: fiestaId, despues: { de: cobradoPor, centavos: total.toString(), cobros: pendientes.length } });
    return { centavos: total };
  });
}

/** El dueño elimina un cobro de la puerta mal cargado (solo mientras no se entregó). */
export async function eliminarVentaPuerta(db: BaseDeDatos, actor: ActorAdmin, ventaId: string) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar un cobro de la puerta");
  return db.transaction(async (tx) => {
    const [venta] = await tx.select().from(ventasPuerta).where(eq(ventasPuerta.id, ventaId)).for("update");
    if (!venta) throw noExiste("El cobro");
    if (venta.estado === "RENDIDA") {
      throw new ErrorNegocio(409, "YA_ENTREGADO", "Esa plata ya se entregó a un admin: para sacarla, eliminá la fiesta o cargá un gasto.");
    }
    await anularAsiento(tx, actor, { asientoId: venta.asientoId, motivo: "Cobro de la puerta eliminado" });
    await tx.execute(sql`select set_config('app.eliminando', ${`ventas_puerta:${ventaId}`}, true)`);
    await tx.delete(ventasPuerta).where(eq(ventasPuerta.id, ventaId));
    await tx.execute(sql`select set_config('app.eliminando', '', true)`);
    await registrarAuditoria(tx, actor, { accion: "COBRO_PUERTA_ELIMINADO", entidad: "ventas_puerta", entidadId: ventaId, antes: { montoCentavos: venta.montoCentavos.toString(), por: venta.cobradoPor } });
  });
}
