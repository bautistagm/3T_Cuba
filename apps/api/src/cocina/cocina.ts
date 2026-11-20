/**
 * Cocina de la camada en los sábados de local.
 *
 * La plata funciona como un adelanto: el plantel le transfiere a la camada, la camada gasta (tickets),
 * y al cerrar se rinde la diferencia. Todo pasa por una cuenta de caja propia de cada cocina
 * ("plata en manos de la camada"), así el saldo siempre sale del libro de caja.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { anularAsiento, registrarAsiento, saldoDeCuenta, type ActorAdmin, type LineaAsiento } from "../caja/libro.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { cocinas, cuentasCaja, gastos, movimientosCocina, sabados } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { gastosConItems, registrarGasto, type ItemGasto } from "../gastos/gastos.js";

export const codigoCuentaCocina = (cocinaId: string) => `COCINA:${cocinaId}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const nuevoToken = () => randomBytes(24).toString("base64url");

/** La cocina sin el hash del link (para mostrar o auditar). */
function sinToken<T extends { tokenHash: string }>(cocina: T): Omit<T, "tokenHash"> {
  const copia: Partial<T> = { ...cocina };
  delete copia.tokenHash;
  return copia as Omit<T, "tokenHash">;
}

type Medio = "TRANSFERENCIA" | "EFECTIVO";
type TipoMovimiento = (typeof movimientosCocina.$inferSelect)["tipo"];

/** Cuenta de la plata del plantel desde/hacia donde se mueve: la cuenta del alias o el efectivo de quien registra. */
const cuentaDelPlantel = (medio: Medio, adminId: string) => (medio === "EFECTIVO" ? codigoEfectivo(adminId) : "CUENTA");

async function cocinaBloqueada(tx: Transaccion, cocinaId: string) {
  const [cocina] = await tx.select().from(cocinas).where(eq(cocinas.id, cocinaId)).for("update");
  if (!cocina) throw noExiste("La cocina");
  return cocina;
}

function exigirAbierta(cocina: { estado: string }) {
  if (cocina.estado !== "ABIERTA") throw new ErrorNegocio(409, "COCINA_CERRADA", "La cocina de ese sábado ya se cerró.");
}

export interface DatosCocina {
  sabadoId: string;
  camada: string;
  responsableNombre: string;
  responsableTelefono?: string | undefined;
}

/** Asigna la camada que cocina un sábado. Devuelve el link del responsable (se muestra una sola vez). */
export async function crearCocina(db: BaseDeDatos, actor: ActorAdmin, datos: DatosCocina) {
  const camada = datos.camada.trim();
  const responsable = datos.responsableNombre.trim();
  if (!camada) throw new ErrorNegocio(400, "FALTA_CAMADA", "Falta la camada.");
  if (!responsable) throw new ErrorNegocio(400, "FALTA_RESPONSABLE", "Falta el nombre del responsable.");
  const token = nuevoToken();

  const cocina = await db.transaction(async (tx) => {
    const [sabado] = await tx.select().from(sabados).where(eq(sabados.id, datos.sabadoId)).for("update");
    if (!sabado) throw noExiste("El sábado");
    const [existente] = await tx.select({ id: cocinas.id }).from(cocinas).where(eq(cocinas.sabadoId, sabado.id)).limit(1);
    if (existente) throw new ErrorNegocio(409, "YA_HAY_COCINA", "Ese sábado ya tiene una camada asignada para cocinar.");
    if (!sabado.esLocal) await tx.update(sabados).set({ esLocal: true }).where(eq(sabados.id, sabado.id));

    const [nueva] = await tx
      .insert(cocinas)
      .values({
        sabadoId: sabado.id,
        camada: camada.slice(0, 60),
        responsableNombre: responsable.slice(0, 80),
        responsableTelefono: datos.responsableTelefono?.trim().slice(0, 30) || null,
        tokenHash: hashToken(token),
      })
      .returning();
    if (!nueva) throw new Error("No se pudo crear la cocina");
    await tx.insert(cuentasCaja).values({
      codigo: codigoCuentaCocina(nueva.id),
      nombre: `En manos de la camada ${nueva.camada} (sábado ${sabado.fecha})`,
      tipo: "ACTIVO",
    });
    await registrarAuditoria(tx, actor, { accion: "COCINA_CREADA", entidad: "cocina", entidadId: nueva.id, despues: sinToken(nueva) });
    return nueva;
  });
  return { cocina: sinToken(cocina), token };
}

/** Genera un link nuevo para el responsable; el anterior deja de funcionar. */
export async function regenerarLink(db: BaseDeDatos, actor: ActorAdmin, cocinaId: string) {
  const token = nuevoToken();
  await db.transaction(async (tx) => {
    const cocina = await cocinaBloqueada(tx, cocinaId);
    exigirAbierta(cocina);
    await tx.update(cocinas).set({ tokenHash: hashToken(token) }).where(eq(cocinas.id, cocinaId));
    await registrarAuditoria(tx, actor, { accion: "COCINA_LINK_REGENERADO", entidad: "cocina", entidadId: cocinaId });
  });
  return token;
}

/** La cocina de un link de responsable. Solo sirve mientras la cocina está abierta. */
export async function cocinaPorToken(db: Ejecutor, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [cocina] = await db
    .select()
    .from(cocinas)
    .where(and(eq(cocinas.tokenHash, hashToken(token)), eq(cocinas.estado, "ABIERTA")))
    .limit(1);
  return cocina ?? null;
}

async function registrarMovimiento(
  tx: Transaccion,
  actor: ActorAdmin,
  cocina: { id: string; camada: string },
  datos: { tipo: TipoMovimiento; monto: bigint; medio: Medio | null; nota?: string | undefined; contrapartida: LineaAsiento },
) {
  const cuentaCocina = codigoCuentaCocina(cocina.id);
  // Lo que entra a la camada suma en su cuenta; lo que sale, resta.
  const sumaEnCocina = datos.tipo === "ADELANTO" || datos.tipo === "REINTEGRO" || datos.tipo === "EXCESO_NO_REINTEGRADO";
  const montoCocina = sumaEnCocina ? datos.monto : -datos.monto;
  const descripciones: Record<TipoMovimiento, string> = {
    ADELANTO: "Plata para la cocina",
    DEVOLUCION: "Devolución de lo que sobró de la cocina",
    REINTEGRO: "Reintegro de lo gastado de más en la cocina",
    SOBRANTE_NO_DEVUELTO: "Sobrante de la cocina que no se reclama",
    EXCESO_NO_REINTEGRADO: "Gasto de más de la cocina que pone la camada",
  };
  const asientoId = await registrarAsiento(tx, actor, {
    fecha: new Date(),
    descripcion: `${descripciones[datos.tipo]} (camada ${cocina.camada})${datos.nota ? `. ${datos.nota}` : ""}`,
    origen: datos.tipo === "ADELANTO" ? "ADELANTO" : datos.tipo === "DEVOLUCION" || datos.tipo === "REINTEGRO" ? "RENDICION" : "AJUSTE",
    origenId: cocina.id,
    lineas: [{ cuentaCodigo: cuentaCocina, montoCentavos: montoCocina }, datos.contrapartida],
  });
  const [movimiento] = await tx
    .insert(movimientosCocina)
    .values({
      cocinaId: cocina.id,
      tipo: datos.tipo,
      montoCentavos: datos.monto,
      medio: datos.medio,
      nota: datos.nota?.trim().slice(0, 200) || null,
      registradoPorAdminId: actor.adminId,
      asientoId,
    })
    .returning();
  if (!movimiento) throw new Error("No se pudo registrar el movimiento");
  await registrarAuditoria(tx, actor, {
    accion: `COCINA_${datos.tipo}`,
    entidad: "movimiento_cocina",
    entidadId: movimiento.id,
    despues: movimiento,
  });
  return movimiento;
}

/** El plantel le pasa plata a la camada (se puede repetir si piden más). */
export async function adelantar(
  db: BaseDeDatos,
  actor: ActorAdmin,
  datos: { cocinaId: string; montoCentavos: bigint; medio: Medio; nota?: string | undefined },
) {
  return db.transaction(async (tx) => {
    const cocina = await cocinaBloqueada(tx, datos.cocinaId);
    exigirAbierta(cocina);
    return registrarMovimiento(tx, actor, cocina, {
      tipo: "ADELANTO",
      monto: datos.montoCentavos,
      medio: datos.medio,
      nota: datos.nota,
      contrapartida: { cuentaCodigo: cuentaDelPlantel(datos.medio, actor.adminId), montoCentavos: -datos.montoCentavos },
    });
  });
}

/** Un gasto de la camada (cargado por un admin, o por el responsable desde su link). */
export async function gastoDeCocina(
  db: BaseDeDatos,
  actor: Actor,
  datos: { cocinaId: string; fecha?: Date | undefined; proveedor?: string | undefined; origenCarga: "IA" | "MANUAL"; items: readonly ItemGasto[] },
) {
  return db.transaction(async (tx) => {
    const cocina = await cocinaBloqueada(tx, datos.cocinaId);
    exigirAbierta(cocina);
    return registrarGasto(tx, actor, {
      fecha: datos.fecha ?? new Date(),
      proveedor: datos.proveedor,
      cuentaOrigenCodigo: codigoCuentaCocina(cocina.id),
      cocinaId: cocina.id,
      sabadoId: cocina.sabadoId,
      origenCarga: datos.origenCarga,
      items: datos.items,
    });
  });
}

export async function resumenCocina(db: Ejecutor, cocinaId: string) {
  const [cocina] = await db.select().from(cocinas).where(eq(cocinas.id, cocinaId)).limit(1);
  if (!cocina) throw noExiste("La cocina");
  const totales = await db
    .select({ tipo: movimientosCocina.tipo, total: sql<string>`sum(${movimientosCocina.montoCentavos})::text` })
    .from(movimientosCocina)
    .where(and(eq(movimientosCocina.cocinaId, cocinaId), eq(movimientosCocina.estado, "CONFIRMADO")))
    .groupBy(movimientosCocina.tipo);
  const total = (tipo: TipoMovimiento) => BigInt(totales.find((t) => t.tipo === tipo)?.total ?? "0");
  const [gastado] = await db
    .select({ total: sql<string>`coalesce(sum(${gastos.totalCentavos}), 0)::text` })
    .from(gastos)
    .where(and(eq(gastos.cocinaId, cocinaId), eq(gastos.estado, "CONFIRMADO")));

  return {
    cocina: sinToken(cocina),
    adelantadoCentavos: total("ADELANTO"),
    gastadoCentavos: BigInt(gastado?.total ?? "0"),
    devueltoCentavos: total("DEVOLUCION"),
    reintegradoCentavos: total("REINTEGRO"),
    sobranteNoDevueltoCentavos: total("SOBRANTE_NO_DEVUELTO"),
    excesoNoReintegradoCentavos: total("EXCESO_NO_REINTEGRADO"),
    /** Lo que tiene la camada ahora. Positivo: tienen plata del plantel. Negativo: el plantel les debe. Sale de la caja. */
    saldoCentavos: await saldoDeCuenta(db, codigoCuentaCocina(cocinaId)),
    movimientos: await db.select().from(movimientosCocina).where(eq(movimientosCocina.cocinaId, cocinaId)).orderBy(movimientosCocina.creadoEn),
    gastos: await gastosConItems(db, { cocinaId }),
  };
}

export type FormaDeCierre =
  | "SIN_DIFERENCIA"
  | "DEVOLUCION_TRANSFERENCIA"
  | "DEVOLUCION_EFECTIVO"
  | "REINTEGRO_TRANSFERENCIA"
  | "REINTEGRO_EFECTIVO"
  | "SOBRANTE_NO_DEVUELTO"
  | "EXCESO_NO_REINTEGRADO";

/**
 * Cierra la cocina y rinde la diferencia, para que su cuenta quede en cero.
 * - Sobró plata: la camada la devuelve (transferencia o efectivo a quien cierra), o el dueño decide no reclamarla.
 * - Gastaron de más: el plantel les reintegra, o el dueño decide no reintegrar.
 */
export async function cerrarCocina(
  db: BaseDeDatos,
  actor: ActorAdmin,
  datos: { cocinaId: string; forma: FormaDeCierre; motivo?: string | undefined },
) {
  return db.transaction(async (tx) => {
    const cocina = await cocinaBloqueada(tx, datos.cocinaId);
    exigirAbierta(cocina);
    const saldo = await saldoDeCuenta(tx, codigoCuentaCocina(cocina.id));
    const motivo = datos.motivo?.trim() ?? "";

    const formasPosibles: FormaDeCierre[] =
      saldo > 0n
        ? ["DEVOLUCION_TRANSFERENCIA", "DEVOLUCION_EFECTIVO", "SOBRANTE_NO_DEVUELTO"]
        : saldo < 0n
          ? ["REINTEGRO_TRANSFERENCIA", "REINTEGRO_EFECTIVO", "EXCESO_NO_REINTEGRADO"]
          : ["SIN_DIFERENCIA"];
    if (!formasPosibles.includes(datos.forma)) {
      throw new ErrorNegocio(409, "FORMA_DE_CIERRE_INVALIDA", "La forma de cierre no corresponde al saldo actual de la cocina. Actualizá la pantalla.");
    }
    if (datos.forma === "SOBRANTE_NO_DEVUELTO" || datos.forma === "EXCESO_NO_REINTEGRADO") {
      if (actor.rol !== "DUENO") throw soloDueno("cerrar la cocina dejando una diferencia");
      if (motivo.length < 5) throw new ErrorNegocio(400, "FALTA_MOTIVO", "Escribí el motivo.");
    }

    const monto = saldo < 0n ? -saldo : saldo;
    switch (datos.forma) {
      case "SIN_DIFERENCIA":
        break;
      case "DEVOLUCION_TRANSFERENCIA":
      case "DEVOLUCION_EFECTIVO": {
        const medio: Medio = datos.forma === "DEVOLUCION_EFECTIVO" ? "EFECTIVO" : "TRANSFERENCIA";
        await registrarMovimiento(tx, actor, cocina, {
          tipo: "DEVOLUCION", monto, medio, nota: motivo,
          contrapartida: { cuentaCodigo: cuentaDelPlantel(medio, actor.adminId), montoCentavos: monto },
        });
        break;
      }
      case "REINTEGRO_TRANSFERENCIA":
      case "REINTEGRO_EFECTIVO": {
        const medio: Medio = datos.forma === "REINTEGRO_EFECTIVO" ? "EFECTIVO" : "TRANSFERENCIA";
        await registrarMovimiento(tx, actor, cocina, {
          tipo: "REINTEGRO", monto, medio, nota: motivo,
          contrapartida: { cuentaCodigo: cuentaDelPlantel(medio, actor.adminId), montoCentavos: -monto },
        });
        break;
      }
      case "SOBRANTE_NO_DEVUELTO":
        await registrarMovimiento(tx, actor, cocina, {
          tipo: "SOBRANTE_NO_DEVUELTO", monto, medio: null, nota: motivo,
          contrapartida: { cuentaCodigo: "EGRESO:COCINA_CAMADAS", montoCentavos: monto },
        });
        break;
      case "EXCESO_NO_REINTEGRADO":
        await registrarMovimiento(tx, actor, cocina, {
          tipo: "EXCESO_NO_REINTEGRADO", monto, medio: null, nota: motivo,
          contrapartida: { cuentaCodigo: "INGRESO:OTROS", montoCentavos: -monto },
        });
        break;
    }

    if ((await saldoDeCuenta(tx, codigoCuentaCocina(cocina.id))) !== 0n) {
      throw new Error("La cuenta de la cocina no quedó en cero al cerrar");
    }
    const [cerrada] = await tx
      .update(cocinas)
      .set({ estado: "CERRADA", cerradaEn: new Date(), cerradaPorAdminId: actor.adminId, notaCierre: motivo || null })
      .where(eq(cocinas.id, cocina.id))
      .returning();
    await registrarAuditoria(tx, actor, {
      accion: "COCINA_CERRADA",
      entidad: "cocina",
      entidadId: cocina.id,
      despues: { forma: datos.forma, saldoAlCerrar: saldo, motivo },
    });
    return cerrada;
  });
}

/** Solo el dueño anula un movimiento de plata de la cocina, y solo mientras está abierta. */
export async function anularMovimientoCocina(db: BaseDeDatos, actor: ActorAdmin, movimientoId: string, motivo: string) {
  if (actor.rol !== "DUENO") throw soloDueno("anular un movimiento de la cocina");
  return db.transaction(async (tx) => {
    const [movimiento] = await tx.select().from(movimientosCocina).where(eq(movimientosCocina.id, movimientoId)).for("update");
    if (!movimiento) throw noExiste("El movimiento");
    const cocina = await cocinaBloqueada(tx, movimiento.cocinaId);
    exigirAbierta(cocina);
    if (movimiento.estado === "ANULADO") throw new ErrorNegocio(409, "YA_ANULADO", "Este movimiento ya estaba anulado.");
    const anulacionAsientoId = await anularAsiento(tx, actor, { asientoId: movimiento.asientoId, motivo });
    const [despues] = await tx
      .update(movimientosCocina)
      .set({ estado: "ANULADO", anuladoEn: new Date(), anuladoPorAdminId: actor.adminId, motivoAnulacion: motivo.trim(), anulacionAsientoId })
      .where(eq(movimientosCocina.id, movimientoId))
      .returning();
    await registrarAuditoria(tx, actor, {
      accion: "COCINA_MOVIMIENTO_ANULADO",
      entidad: "movimiento_cocina",
      entidadId: movimientoId,
      antes: movimiento,
      despues,
    });
    return despues;
  });
}

export async function cocinaDelSabado(db: Ejecutor, sabadoId: string) {
  const [cocina] = await db.select({ id: cocinas.id }).from(cocinas).where(eq(cocinas.sabadoId, sabadoId)).limit(1);
  return cocina ? resumenCocina(db, cocina.id) : null;
}
