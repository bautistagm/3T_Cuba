/**
 * Operaciones de Caja: dónde está la plata, el efectivo con responsable, gastos generales y el control
 * contra la reserva real. Todo sale del libro de caja (doble partida).
 */
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import type { BaseDeDatos, Ejecutor } from "../db/cliente.js";
import { admins, asientosCaja, cocinas, controlesCaja, cuentasCaja, movimientosCaja, sabados, traspasosEfectivo } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { registrarGasto, type ItemGasto } from "../gastos/gastos.js";
import { codigoEfectivo } from "./cuentas.js";
import { registrarAsiento, saldoDeCuenta, type ActorAdmin } from "./libro.js";

/** Dónde está la plata del plantel ahora. */
export async function saldosCaja(db: Ejecutor) {
  const filas = await db
    .select({
      codigo: cuentasCaja.codigo,
      nombre: cuentasCaja.nombre,
      adminId: cuentasCaja.adminId,
      saldo: sql<string>`coalesce(sum(${movimientosCaja.montoCentavos}), 0)::text`,
    })
    .from(cuentasCaja)
    .leftJoin(movimientosCaja, eq(movimientosCaja.cuentaId, cuentasCaja.id))
    .where(eq(cuentasCaja.tipo, "ACTIVO"))
    .groupBy(cuentasCaja.id);

  const nombres = new Map((await db.select({ id: admins.id, nombre: admins.nombre }).from(admins)).map((a) => [a.id, a.nombre]));
  const cocinasAbiertas = await db
    .select({ id: cocinas.id, camada: cocinas.camada, fecha: sabados.fecha, estado: cocinas.estado })
    .from(cocinas)
    .innerJoin(sabados, eq(sabados.id, cocinas.sabadoId));
  const datosCocina = new Map(cocinasAbiertas.map((c) => [`COCINA:${c.id}`, c]));

  let cuenta = 0n;
  let total = 0n;
  const efectivo: { adminId: string; nombre: string; centavos: bigint }[] = [];
  const camadas: { cocinaId: string; camada: string; fecha: string; centavos: bigint }[] = [];
  for (const f of filas) {
    const saldo = BigInt(f.saldo);
    total += saldo;
    if (f.codigo === "CUENTA") cuenta = saldo;
    else if (f.adminId) {
      if (saldo !== 0n) efectivo.push({ adminId: f.adminId, nombre: nombres.get(f.adminId) ?? "?", centavos: saldo });
    } else if (f.codigo.startsWith("COCINA:") && saldo !== 0n) {
      const c = datosCocina.get(f.codigo);
      if (c) camadas.push({ cocinaId: c.id, camada: c.camada, fecha: c.fecha, centavos: saldo });
    }
  }
  efectivo.sort((a, b) => (a.centavos > b.centavos ? -1 : 1));
  return { totalCentavos: total, cuentaCentavos: cuenta, efectivo, camadas };
}

/** El efectivo que tiene a cargo un admin. */
export const efectivoDe = (db: Ejecutor, adminId: string) => saldoDeCuenta(db, codigoEfectivo(adminId));

async function exigirEfectivo(db: Ejecutor, adminId: string, monto: bigint) {
  const tiene = await efectivoDe(db, adminId);
  if (monto > tiene) {
    throw new ErrorNegocio(422, "EFECTIVO_INSUFICIENTE", "No tenés tanto efectivo del plantel a tu cargo.");
  }
}

/** El admin deposita en el alias efectivo que tenía a cargo. */
export async function depositarEfectivo(db: BaseDeDatos, actor: ActorAdmin, datos: { montoCentavos: bigint; nota?: string | undefined }) {
  return db.transaction(async (tx) => {
    // Bloqueamos la cuenta de efectivo del admin para que dos operaciones no usen la misma plata.
    await tx.select().from(cuentasCaja).where(eq(cuentasCaja.codigo, codigoEfectivo(actor.adminId))).for("update");
    await exigirEfectivo(tx, actor.adminId, datos.montoCentavos);
    return registrarAsiento(tx, actor, {
      fecha: new Date(),
      descripcion: `Depósito de efectivo en el alias${datos.nota ? `. ${datos.nota}` : ""}`,
      origen: "RENDICION",
      lineas: [
        { cuentaCodigo: codigoEfectivo(actor.adminId), montoCentavos: -datos.montoCentavos },
        { cuentaCodigo: "CUENTA", montoCentavos: datos.montoCentavos },
      ],
    });
  });
}

/** Un admin le entrega efectivo a otro. Queda pendiente hasta que el que recibe lo confirma. */
export async function iniciarTraspaso(
  db: BaseDeDatos,
  actor: ActorAdmin,
  datos: { paraAdminId: string; montoCentavos: bigint; nota?: string | undefined },
) {
  if (datos.paraAdminId === actor.adminId) throw new ErrorNegocio(400, "MISMA_PERSONA", "No te podés entregar efectivo a vos mismo.");
  return db.transaction(async (tx) => {
    const [para] = await tx.select().from(admins).where(eq(admins.id, datos.paraAdminId)).limit(1);
    if (!para || !para.activo) throw noExiste("El administrador que recibe");
    await exigirEfectivo(tx, actor.adminId, datos.montoCentavos);
    const [traspaso] = await tx
      .insert(traspasosEfectivo)
      .values({ deAdminId: actor.adminId, paraAdminId: para.id, montoCentavos: datos.montoCentavos, nota: datos.nota?.trim() || null })
      .returning();
    if (!traspaso) throw new Error("No se pudo registrar el traspaso");
    await registrarAuditoria(tx, actor, { accion: "TRASPASO_INICIADO", entidad: "traspaso", entidadId: traspaso.id, despues: traspaso });
    return traspaso;
  });
}

async function traspasoPendiente(tx: Ejecutor, id: string) {
  const [traspaso] = await tx.select().from(traspasosEfectivo).where(eq(traspasosEfectivo.id, id)).for("update");
  if (!traspaso) throw noExiste("El traspaso");
  if (traspaso.estado !== "PENDIENTE") throw new ErrorNegocio(409, "TRASPASO_RESUELTO", "Este traspaso ya se resolvió.");
  return traspaso;
}

/** El que recibe confirma: recién ahí la plata pasa a su cargo. */
export async function confirmarTraspaso(db: BaseDeDatos, actor: ActorAdmin, traspasoId: string) {
  return db.transaction(async (tx) => {
    const t = await traspasoPendiente(tx, traspasoId);
    if (t.paraAdminId !== actor.adminId) throw new ErrorNegocio(403, "NO_ES_PARA_VOS", "Solo puede confirmarlo quien recibe la plata.");
    await tx.select().from(cuentasCaja).where(eq(cuentasCaja.codigo, codigoEfectivo(t.deAdminId))).for("update");
    const tiene = await efectivoDe(tx, t.deAdminId);
    if (t.montoCentavos > tiene) {
      throw new ErrorNegocio(422, "EFECTIVO_INSUFICIENTE", "Quien te lo entrega ya no tiene ese efectivo a su cargo en la app. Pedile que lo revise.");
    }
    const [de] = await tx.select({ nombre: admins.nombre }).from(admins).where(eq(admins.id, t.deAdminId));
    const asientoId = await registrarAsiento(tx, actor, {
      fecha: new Date(),
      descripcion: `Efectivo entregado por ${de?.nombre ?? "?"}${t.nota ? `. ${t.nota}` : ""}`,
      origen: "RENDICION",
      origenId: t.id,
      lineas: [
        { cuentaCodigo: codigoEfectivo(t.deAdminId), montoCentavos: -t.montoCentavos },
        { cuentaCodigo: codigoEfectivo(t.paraAdminId), montoCentavos: t.montoCentavos },
      ],
    });
    const [despues] = await tx
      .update(traspasosEfectivo)
      .set({ estado: "CONFIRMADO", asientoId, resueltoEn: new Date() })
      .where(eq(traspasosEfectivo.id, t.id))
      .returning();
    await registrarAuditoria(tx, actor, { accion: "TRASPASO_CONFIRMADO", entidad: "traspaso", entidadId: t.id, despues });
    return despues;
  });
}

/** El que recibe dice que no lo recibió, o el que entrega lo cancela. La plata sigue a cargo del que la tenía. */
export async function rechazarOCancelarTraspaso(db: BaseDeDatos, actor: ActorAdmin, traspasoId: string) {
  return db.transaction(async (tx) => {
    const t = await traspasoPendiente(tx, traspasoId);
    const estado = t.paraAdminId === actor.adminId ? "RECHAZADO" : t.deAdminId === actor.adminId ? "CANCELADO" : null;
    if (!estado) throw new ErrorNegocio(403, "NO_PARTICIPA", "Solo quien entrega o quien recibe puede hacer esto.");
    const [despues] = await tx
      .update(traspasosEfectivo)
      .set({ estado, resueltoEn: new Date() })
      .where(eq(traspasosEfectivo.id, t.id))
      .returning();
    await registrarAuditoria(tx, actor, { accion: `TRASPASO_${estado}`, entidad: "traspaso", entidadId: t.id, despues });
    return despues;
  });
}

export async function traspasosPendientes(db: Ejecutor, adminId: string) {
  return db
    .select()
    .from(traspasosEfectivo)
    .where(and(eq(traspasosEfectivo.estado, "PENDIENTE"), or(eq(traspasosEfectivo.deAdminId, adminId), eq(traspasosEfectivo.paraAdminId, adminId))))
    .orderBy(desc(traspasosEfectivo.creadoEn));
}

export type DesdeDonde = "CUENTA" | "EFECTIVO";
export const cuentaDeOrigen = (desde: DesdeDonde, adminId: string) => (desde === "EFECTIVO" ? codigoEfectivo(adminId) : "CUENTA");

/** Un gasto que no es de una cocina (por ejemplo, una compra para el almacén). */
export async function gastoGeneral(
  db: BaseDeDatos,
  actor: ActorAdmin,
  datos: { desde: DesdeDonde; proveedor?: string | undefined; fecha?: Date | undefined; items: readonly ItemGasto[] },
) {
  return db.transaction(async (tx) => {
    const cuenta = cuentaDeOrigen(datos.desde, actor.adminId);
    if (datos.desde === "EFECTIVO") {
      await tx.select().from(cuentasCaja).where(eq(cuentasCaja.codigo, cuenta)).for("update");
      const total = datos.items.reduce((t, i) => t + i.subtotalCentavos, 0n);
      await exigirEfectivo(tx, actor.adminId, total);
    }
    return registrarGasto(tx, actor, {
      fecha: datos.fecha ?? new Date(),
      proveedor: datos.proveedor,
      cuentaOrigenCodigo: cuenta,
      origenCarga: "MANUAL",
      items: datos.items,
    });
  });
}

/**
 * El dueño carga lo que tiene apartado en la reserva del plantel. Se compara con el libro.
 * Si hay diferencia y decide ajustar, se registra un ajuste con motivo.
 */
export async function controlarCaja(
  db: BaseDeDatos,
  actor: ActorAdmin,
  datos: { declaradoCentavos: bigint; ajustar: boolean; motivo?: string | undefined },
) {
  if (actor.rol !== "DUENO") throw soloDueno("controlar la caja");
  if (datos.declaradoCentavos < 0n) throw new ErrorNegocio(400, "MONTO_INVALIDO", "El monto no puede ser negativo.");
  return db.transaction(async (tx) => {
    await tx.select().from(cuentasCaja).where(eq(cuentasCaja.codigo, "CUENTA")).for("update");
    const libro = await saldoDeCuenta(tx, "CUENTA");
    const diferencia = datos.declaradoCentavos - libro;
    let ajusteAsientoId: string | null = null;
    const motivo = datos.motivo?.trim() ?? "";
    if (datos.ajustar && diferencia !== 0n) {
      if (motivo.length < 5) throw new ErrorNegocio(400, "FALTA_MOTIVO", "Para ajustar hay que escribir el motivo.");
      ajusteAsientoId = await registrarAsiento(tx, actor, {
        fecha: new Date(),
        descripcion: `Ajuste de caja (${diferencia > 0n ? "sobrante" : "faltante"}). Motivo: ${motivo}`,
        origen: "AJUSTE",
        lineas: [
          { cuentaCodigo: "CUENTA", montoCentavos: diferencia },
          diferencia > 0n
            ? { cuentaCodigo: "INGRESO:AJUSTES", montoCentavos: -diferencia }
            : { cuentaCodigo: "EGRESO:AJUSTES", montoCentavos: -diferencia },
        ],
      });
    }
    const [control] = await tx
      .insert(controlesCaja)
      .values({
        declaradoCentavos: datos.declaradoCentavos,
        libroCentavos: libro,
        diferenciaCentavos: diferencia,
        ajusteAsientoId,
        motivo: motivo || null,
        realizadoPorAdminId: actor.adminId,
      })
      .returning();
    if (!control) throw new Error("No se pudo guardar el control");
    await registrarAuditoria(tx, actor, { accion: "CAJA_CONTROLADA", entidad: "control_caja", entidadId: control.id, despues: control });
    return control;
  });
}

export async function ultimoControl(db: Ejecutor) {
  const [control] = await db.select().from(controlesCaja).orderBy(desc(controlesCaja.creadoEn)).limit(1);
  return control ?? null;
}

/**
 * Movimientos de caja para mostrar, del más nuevo al más viejo.
 * "Entrada" o "salida" se mide sobre la plata del plantel (cuentas de activo); los pases internos (depósitos,
 * entregas de efectivo, plata a la camada) no cambian el total.
 */
export async function listarMovimientos(db: Ejecutor, opciones: { limite?: number; antesDe?: Date | undefined } = {}) {
  const limite = Math.min(opciones.limite ?? 50, 200);
  const asientos = await db
    .select()
    .from(asientosCaja)
    .where(opciones.antesDe ? lt(asientosCaja.creadoEn, opciones.antesDe) : undefined)
    .orderBy(desc(asientosCaja.creadoEn))
    .limit(limite);
  if (asientos.length === 0) return [];
  const lineas = await db
    .select({
      asientoId: movimientosCaja.asientoId,
      montoCentavos: movimientosCaja.montoCentavos,
      cuentaCodigo: cuentasCaja.codigo,
      cuentaNombre: cuentasCaja.nombre,
      tipoCuenta: cuentasCaja.tipo,
    })
    .from(movimientosCaja)
    .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
    .where(inArray(movimientosCaja.asientoId, asientos.map((a) => a.id)));
  const nombres = new Map((await db.select({ id: admins.id, nombre: admins.nombre }).from(admins)).map((a) => [a.id, a.nombre]));
  const anulados = new Set(
    (
      await db
        .select({ id: asientosCaja.anulaAsientoId })
        .from(asientosCaja)
        .where(inArray(asientosCaja.anulaAsientoId, asientos.map((a) => a.id)))
    ).map((f) => f.id),
  );

  return asientos.map((a) => {
    const propias = lineas.filter((l) => l.asientoId === a.id);
    const efectoTotal = propias.filter((l) => l.tipoCuenta === "ACTIVO").reduce((t, l) => t + l.montoCentavos, 0n);
    const motivo = propias.find((l) => l.tipoCuenta !== "ACTIVO");
    return {
      id: a.id,
      fecha: a.fecha,
      creadoEn: a.creadoEn,
      descripcion: a.descripcion,
      origen: a.origen,
      tipo: efectoTotal > 0n ? "ENTRADA" : efectoTotal < 0n ? "SALIDA" : "INTERNO",
      montoCentavos: efectoTotal !== 0n ? (efectoTotal < 0n ? -efectoTotal : efectoTotal) : propias.filter((l) => l.montoCentavos > 0n).reduce((t, l) => t + l.montoCentavos, 0n),
      categoria: motivo?.cuentaNombre ?? null,
      registradoPor: a.creadoPorAdminId ? (nombres.get(a.creadoPorAdminId) ?? "?") : "Responsable de camada",
      anulado: anulados.has(a.id),
      lineas: propias.map((l) => ({ cuenta: l.cuentaNombre, montoCentavos: l.montoCentavos })),
    };
  });
}
