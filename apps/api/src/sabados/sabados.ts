/**
 * Sábados e invitados del tercer tiempo.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Ejecutor } from "../db/cliente.js";
import { pagos, parametros, sabados } from "../db/esquema.js";
import { liberarCuotasDelPago } from "../cuotas/cuotas.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { esSabado } from "./fechas.js";

export const PARAMETRO_PRECIO_INVITADO = "precio_invitado_centavos";

export async function precioInvitado(db: Ejecutor): Promise<bigint | null> {
  const [fila] = await db.select().from(parametros).where(eq(parametros.clave, PARAMETRO_PRECIO_INVITADO)).limit(1);
  return fila ? BigInt(fila.valor) : null;
}

/** Solo el dueño fija el precio de los invitados. */
export async function fijarPrecioInvitado(db: BaseDeDatos, actor: ActorAdmin, centavos: bigint): Promise<void> {
  if (actor.rol !== "DUENO") throw soloDueno("cambiar el precio de los invitados");
  await db.transaction(async (tx) => {
    const antes = await precioInvitado(tx);
    await tx
      .insert(parametros)
      .values({ clave: PARAMETRO_PRECIO_INVITADO, valor: centavos.toString(), actualizadoPorAdminId: actor.adminId })
      .onConflictDoUpdate({
        target: parametros.clave,
        set: { valor: centavos.toString(), actualizadoPorAdminId: actor.adminId, actualizadoEn: new Date() },
      });
    await registrarAuditoria(tx, actor, {
      accion: "PRECIO_INVITADO_CAMBIADO",
      entidad: "parametro",
      entidadId: PARAMETRO_PRECIO_INVITADO,
      antes: { centavos: antes },
      despues: { centavos },
    });
  });
}

/** Devuelve el sábado de esa fecha; si todavía no existe, lo crea. */
export async function obtenerOCrearSabado(db: Ejecutor, fecha: string) {
  if (!esSabado(fecha)) throw new ErrorNegocio(400, "NO_ES_SABADO", `${fecha} no es un sábado.`);
  await db.insert(sabados).values({ fecha }).onConflictDoNothing({ target: sabados.fecha });
  const [sabado] = await db.select().from(sabados).where(eq(sabados.fecha, fecha)).limit(1);
  if (!sabado) throw new Error("No se pudo crear el sábado");
  return sabado;
}

export async function buscarSabado(db: Ejecutor, id: string) {
  const [sabado] = await db.select().from(sabados).where(eq(sabados.id, id)).limit(1);
  if (!sabado) throw noExiste("El sábado");
  return sabado;
}

export async function marcarLocal(db: BaseDeDatos, actor: ActorAdmin, sabadoId: string, esLocal: boolean) {
  return db.transaction(async (tx) => {
    const antes = await buscarSabado(tx, sabadoId);
    const [despues] = await tx.update(sabados).set({ esLocal }).where(eq(sabados.id, sabadoId)).returning();
    await registrarAuditoria(tx, actor, { accion: "SABADO_LOCAL", entidad: "sabado", entidadId: sabadoId, antes, despues });
    return despues;
  });
}

export interface DatosCobroInvitado {
  sabadoId: string;
  medio: "EFECTIVO" | "TRANSFERENCIA";
  /** Si no se indica, se usa el precio fijado por el dueño. */
  montoCentavos?: bigint | undefined;
  nombre?: string | undefined;
  camada?: string | undefined;
  nota?: string | undefined;
}

const textoOpcional = (t: string | undefined) => {
  const limpio = t?.trim();
  return limpio ? limpio.slice(0, 120) : null;
};

/**
 * Cobra a un invitado. El efectivo queda a cargo del admin que cobró; la transferencia entra a la cuenta.
 * Pago, asiento de caja y auditoría se guardan juntos.
 */
export async function cobrarInvitado(db: BaseDeDatos, actor: ActorAdmin, datos: DatosCobroInvitado) {
  return db.transaction(async (tx) => {
    const sabado = await buscarSabado(tx, datos.sabadoId);
    const monto = datos.montoCentavos ?? (await precioInvitado(tx));
    if (monto === null) {
      throw new ErrorNegocio(422, "SIN_PRECIO", "Todavía no hay un precio fijado para los invitados. Lo fija el dueño.");
    }
    const nombre = textoOpcional(datos.nombre);
    const camada = textoOpcional(datos.camada);
    const quien = [nombre, camada ? `camada ${camada}` : null].filter(Boolean).join(", ");

    const asientoId = await registrarAsiento(tx, actor, {
      fecha: new Date(),
      descripcion: `Invitado sábado ${sabado.fecha.slice(8, 10)}/${sabado.fecha.slice(5, 7)}${quien ? ` (${quien})` : ""}`,
      origen: "PAGO",
      lineas: [
        { cuentaCodigo: datos.medio === "EFECTIVO" ? codigoEfectivo(actor.adminId) : "CUENTA", montoCentavos: monto },
        { cuentaCodigo: "INGRESO:INVITADOS", montoCentavos: -monto },
      ],
    });
    const [pago] = await tx
      .insert(pagos)
      .values({
        origen: "INVITADO",
        montoCentavos: monto,
        medio: datos.medio,
        fecha: new Date(),
        sabadoId: sabado.id,
        nombrePagador: nombre,
        camadaPagador: camada,
        nota: textoOpcional(datos.nota),
        recibidoPorAdminId: datos.medio === "EFECTIVO" ? actor.adminId : null,
        registradoPorAdminId: actor.adminId,
        asientoId,
      })
      .returning();
    if (!pago) throw new Error("No se pudo registrar el cobro");
    await registrarAuditoria(tx, actor, { accion: "INVITADO_COBRADO", entidad: "pago", entidadId: pago.id, despues: pago });
    return pago;
  });
}

/** Solo el dueño anula un pago. Se anula su asiento de caja (espejo) y el pago queda marcado, nunca borrado. */
export async function anularPago(db: BaseDeDatos, actor: ActorAdmin, pagoId: string, motivo: string) {
  if (actor.rol !== "DUENO") throw soloDueno("anular un cobro");
  return db.transaction(async (tx) => {
    const [pago] = await tx.select().from(pagos).where(eq(pagos.id, pagoId)).for("update");
    if (!pago) throw noExiste("El cobro");
    if (pago.estado === "ANULADO") throw new ErrorNegocio(409, "YA_ANULADO", "Este cobro ya estaba anulado.");
    const anulacionAsientoId = await anularAsiento(tx, actor, { asientoId: pago.asientoId, motivo });
    // Si era un pago de cuotas, esas cuotas vuelven a estar pendientes.
    if (pago.origen === "CUOTA") await liberarCuotasDelPago(tx, pago.id);
    const [despues] = await tx
      .update(pagos)
      .set({
        estado: "ANULADO",
        anuladoEn: new Date(),
        anuladoPorAdminId: actor.adminId,
        motivoAnulacion: motivo.trim(),
        anulacionAsientoId,
      })
      .where(eq(pagos.id, pagoId))
      .returning();
    await registrarAuditoria(tx, actor, { accion: "PAGO_ANULADO", entidad: "pago", entidadId: pagoId, antes: pago, despues });
    return despues;
  });
}

export async function cobrosDelSabado(db: Ejecutor, sabadoId: string) {
  return db
    .select()
    .from(pagos)
    .where(and(eq(pagos.sabadoId, sabadoId), eq(pagos.origen, "INVITADO")))
    .orderBy(desc(pagos.fecha));
}

export async function listarSabados(db: Ejecutor, limite = 30) {
  return db
    .select({
      id: sabados.id,
      fecha: sabados.fecha,
      esLocal: sabados.esLocal,
      invitados: sql<number>`count(${pagos.id}) filter (where ${pagos.estado} = 'CONFIRMADO')::int`,
      cobradoCentavos: sql<string>`coalesce(sum(${pagos.montoCentavos}) filter (where ${pagos.estado} = 'CONFIRMADO'), 0)::text`,
    })
    .from(sabados)
    .leftJoin(pagos, and(eq(pagos.sabadoId, sabados.id), eq(pagos.origen, "INVITADO")))
    .groupBy(sabados.id)
    .orderBy(desc(sabados.fecha))
    .limit(limite);
}
