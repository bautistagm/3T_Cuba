/**
 * Cuotas (etapa 8.1).
 *
 * - El dueño abre cada mes fijando el monto; en ese momento se le carga la cuota a todos los jugadores activos.
 * - Cada cuota se paga entera con un solo pago (no hay pagos parciales). Un pago puede cancelar varios meses.
 * - Todo cobro pasa por el libro de caja: el efectivo queda a cargo del admin que cobró; la transferencia entra a la cuenta.
 * - Anular un pago (solo el dueño) devuelve sus cuotas a "pendiente". La base verifica que cada pago de cuotas
 *   sume exactamente lo que cancela.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { sumarCentavos } from "@3t/shared";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { cargos, jugadores, pagos, parametros, periodosCuota } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreDelMes = (anio: number, mes: number) => `${MESES[mes - 1] ?? "?"} ${anio}`;
const conMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

type Cargo = typeof cargos.$inferSelect;

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

export async function abrirMes(db: BaseDeDatos, actor: ActorAdmin, datos: { anio: number; mes: number; montoCentavos: bigint; nota?: string | undefined }) {
  if (actor.rol !== "DUENO") throw soloDueno("abrir un mes de cuotas");
  return db.transaction(async (tx) => {
    const [existe] = await tx
      .select({ id: periodosCuota.id })
      .from(periodosCuota)
      .where(and(eq(periodosCuota.anio, datos.anio), eq(periodosCuota.mes, datos.mes)))
      .limit(1);
    if (existe) throw new ErrorNegocio(409, "MES_YA_ABIERTO", `${conMayuscula(nombreDelMes(datos.anio, datos.mes))} ya está abierto.`);
    const [periodo] = await tx
      .insert(periodosCuota)
      .values({ anio: datos.anio, mes: datos.mes, montoCentavos: datos.montoCentavos, nota: datos.nota?.trim() || null, abiertoPorAdminId: actor.adminId })
      .returning();
    if (!periodo) throw new Error("No se pudo abrir el mes");
    const activos = await tx.select({ id: jugadores.id }).from(jugadores).where(eq(jugadores.estado, "ACTIVO"));
    if (activos.length > 0) {
      await tx.insert(cargos).values(activos.map((j) => ({ jugadorId: j.id, periodoId: periodo.id, montoCentavos: datos.montoCentavos })));
    }
    await registrarAuditoria(tx, actor, {
      accion: "MES_ABIERTO",
      entidad: "periodos_cuota",
      entidadId: periodo.id,
      despues: { anio: datos.anio, mes: datos.mes, montoCentavos: datos.montoCentavos.toString(), cuotas: activos.length },
    });
    return { periodo, cuotasCargadas: activos.length };
  });
}

/** Corrige el monto de un mes mientras nadie lo haya pagado. Cambia también las cuotas pendientes de ese mes. */
export async function cambiarMontoDelMes(db: BaseDeDatos, actor: ActorAdmin, periodoId: string, montoCentavos: bigint) {
  if (actor.rol !== "DUENO") throw soloDueno("cambiar el monto de un mes");
  return db.transaction(async (tx) => {
    const [periodo] = await tx.select().from(periodosCuota).where(eq(periodosCuota.id, periodoId)).for("update");
    if (!periodo) throw noExiste("El mes");
    const [pagado] = await tx
      .select({ id: cargos.id })
      .from(cargos)
      .where(and(eq(cargos.periodoId, periodoId), eq(cargos.estado, "PAGADO")))
      .limit(1);
    if (pagado) throw new ErrorNegocio(409, "YA_HAY_PAGOS", "Ya hay jugadores que pagaron este mes: el monto no se puede cambiar.");
    await tx.update(periodosCuota).set({ montoCentavos }).where(eq(periodosCuota.id, periodoId));
    await tx
      .update(cargos)
      .set({ montoCentavos })
      .where(and(eq(cargos.periodoId, periodoId), eq(cargos.estado, "PENDIENTE"), eq(cargos.montoCentavos, periodo.montoCentavos)));
    await registrarAuditoria(tx, actor, {
      accion: "MES_MONTO_CAMBIADO",
      entidad: "periodos_cuota",
      entidadId: periodoId,
      antes: { montoCentavos: periodo.montoCentavos.toString() },
      despues: { montoCentavos: montoCentavos.toString() },
    });
  });
}

export async function listarMeses(db: BaseDeDatos) {
  const filas = await db
    .select({
      id: periodosCuota.id,
      anio: periodosCuota.anio,
      mes: periodosCuota.mes,
      montoCentavos: periodosCuota.montoCentavos,
      nota: periodosCuota.nota,
      pagaron: sql<number>`count(${cargos.id}) filter (where ${cargos.estado} = 'PAGADO')`.mapWith(Number),
      deben: sql<number>`count(${cargos.id}) filter (where ${cargos.estado} = 'PENDIENTE' and ${jugadores.estado} = 'ACTIVO')`.mapWith(Number),
      cobradoCentavos: sql<string>`coalesce(sum(${cargos.montoCentavos}) filter (where ${cargos.estado} = 'PAGADO'), 0)`,
      faltaCentavos: sql<string>`coalesce(sum(${cargos.montoCentavos}) filter (where ${cargos.estado} = 'PENDIENTE' and ${jugadores.estado} = 'ACTIVO'), 0)`,
    })
    .from(periodosCuota)
    .leftJoin(cargos, eq(cargos.periodoId, periodosCuota.id))
    .leftJoin(jugadores, eq(jugadores.id, cargos.jugadorId))
    .groupBy(periodosCuota.id)
    .orderBy(desc(periodosCuota.anio), desc(periodosCuota.mes));
  return filas.map((f) => ({
    ...f,
    nombre: conMayuscula(nombreDelMes(f.anio, f.mes)),
    cobradoCentavos: BigInt(f.cobradoCentavos),
    faltaCentavos: BigInt(f.faltaCentavos),
  }));
}

// ---------------------------------------------------------------------------
// Cuotas de un jugador
// ---------------------------------------------------------------------------

async function buscarJugadorActivo(db: Ejecutor, jugadorId: string) {
  const [j] = await db.select().from(jugadores).where(eq(jugadores.id, jugadorId)).limit(1);
  if (!j || j.estado === "ELIMINADO") throw noExiste("El jugador");
  return j;
}

export async function cuotasDeJugador(db: BaseDeDatos, jugadorId: string) {
  await buscarJugadorActivo(db, jugadorId);
  const filas = await db
    .select({ cargo: cargos, periodo: periodosCuota })
    .from(cargos)
    .innerJoin(periodosCuota, eq(periodosCuota.id, cargos.periodoId))
    .where(eq(cargos.jugadorId, jugadorId))
    .orderBy(desc(periodosCuota.anio), desc(periodosCuota.mes));
  const tiene = new Set(filas.map((f) => f.periodo.id));
  const meses = await db.select().from(periodosCuota).orderBy(desc(periodosCuota.anio), desc(periodosCuota.mes));
  return {
    cuotas: filas.map(({ cargo, periodo }) => ({
      id: cargo.id,
      periodoId: periodo.id,
      mes: conMayuscula(nombreDelMes(periodo.anio, periodo.mes)),
      montoCentavos: cargo.montoCentavos,
      estado: cargo.estado,
      pagoId: cargo.pagoId,
      motivoAnulacion: cargo.motivoAnulacion,
    })),
    /** Meses abiertos en los que este jugador no tiene cuota (el dueño puede agregársela). */
    mesesSinCuota: meses.filter((m) => !tiene.has(m.id)).map((m) => ({ periodoId: m.id, mes: conMayuscula(nombreDelMes(m.anio, m.mes)), montoCentavos: m.montoCentavos })),
  };
}

/** El dueño le agrega a un jugador la cuota de un mes ya abierto (por ejemplo, si se sumó a mitad de mes). */
export async function agregarCuota(db: BaseDeDatos, actor: ActorAdmin, jugadorId: string, periodoId: string) {
  if (actor.rol !== "DUENO") throw soloDueno("agregarle una cuota a un jugador");
  return db.transaction(async (tx) => {
    const j = await buscarJugadorActivo(tx, jugadorId);
    if (j.estado !== "ACTIVO") throw new ErrorNegocio(409, "NO_ACTIVO", "El jugador está de baja.");
    const [periodo] = await tx.select().from(periodosCuota).where(eq(periodosCuota.id, periodoId)).limit(1);
    if (!periodo) throw noExiste("El mes");
    const [nuevo] = await tx
      .insert(cargos)
      .values({ jugadorId, periodoId, montoCentavos: periodo.montoCentavos })
      .onConflictDoNothing()
      .returning();
    if (!nuevo) throw new ErrorNegocio(409, "YA_TIENE_CUOTA", "Ese jugador ya tiene la cuota de ese mes.");
    await registrarAuditoria(tx, actor, { accion: "CUOTA_AGREGADA", entidad: "cargos", entidadId: nuevo.id, despues: { jugadorId, periodoId } });
    return nuevo;
  });
}

/** El dueño anula una cuota pendiente (no se cobra), con motivo. */
export async function anularCuota(db: BaseDeDatos, actor: ActorAdmin, cargoId: string, motivo: string) {
  if (actor.rol !== "DUENO") throw soloDueno("anular una cuota");
  const limpio = motivo.trim();
  if (limpio.length < 5) throw new ErrorNegocio(400, "FALTA_MOTIVO", "Escribí el motivo (al menos 5 letras).");
  return db.transaction(async (tx) => {
    const [cargo] = await tx.select().from(cargos).where(eq(cargos.id, cargoId)).for("update");
    if (!cargo) throw noExiste("La cuota");
    if (cargo.estado !== "PENDIENTE") {
      throw new ErrorNegocio(409, "NO_PENDIENTE", cargo.estado === "PAGADO" ? "Esa cuota ya está pagada: si hace falta, anulá el pago." : "Esa cuota ya estaba anulada.");
    }
    const [anulado] = await tx
      .update(cargos)
      .set({ estado: "ANULADO", motivoAnulacion: limpio.slice(0, 300), anuladoPorAdminId: actor.adminId, anuladoEn: new Date() })
      .where(eq(cargos.id, cargoId))
      .returning();
    await registrarAuditoria(tx, actor, { accion: "CUOTA_ANULADA", entidad: "cargos", entidadId: cargoId, despues: { motivo: limpio } });
    return anulado;
  });
}

// ---------------------------------------------------------------------------
// Cobros
// ---------------------------------------------------------------------------

/** Cuotas pendientes de un jugador, de la más vieja a la más nueva, bloqueadas para este cobro. */
async function pendientesBloqueadas(tx: Transaccion, jugadorId: string): Promise<(Cargo & { anio: number; mes: number })[]> {
  const filas = await tx
    .select({ cargo: cargos, anio: periodosCuota.anio, mes: periodosCuota.mes })
    .from(cargos)
    .innerJoin(periodosCuota, eq(periodosCuota.id, cargos.periodoId))
    .where(and(eq(cargos.jugadorId, jugadorId), eq(cargos.estado, "PENDIENTE")))
    .orderBy(asc(periodosCuota.anio), asc(periodosCuota.mes))
    .for("update", { of: cargos });
  return filas.map((f) => ({ ...f.cargo, anio: f.anio, mes: f.mes }));
}

/**
 * Registra un pago de cuotas (efectivo o transferencia ya verificada) dentro de una transacción:
 * pago + asiento de caja + cuotas marcadas como pagadas. Lo usan el cobro en efectivo y la verificación automática.
 */
export async function registrarPagoDeCuotas(
  tx: Transaccion,
  actor: ActorAdmin | { tipo: "SISTEMA" },
  datos: {
    jugadorId: string;
    cuotas: (Cargo & { anio: number; mes: number })[];
    medio: "EFECTIVO" | "TRANSFERENCIA";
    fecha: Date;
    /** Para efectivo: el admin que tiene la plata. */
    recibidoPorAdminId?: string;
    nota?: string;
  },
) {
  if (datos.cuotas.length === 0) throw new ErrorNegocio(400, "SIN_CUOTAS", "Elegí al menos una cuota.");
  const monto = sumarCentavos(datos.cuotas.map((c) => c.montoCentavos));
  const [jugador] = await tx.select().from(jugadores).where(eq(jugadores.id, datos.jugadorId)).limit(1);
  if (!jugador) throw noExiste("El jugador");
  const meses = datos.cuotas.map((c) => nombreDelMes(c.anio, c.mes)).join(", ");
  if (datos.medio === "EFECTIVO" && !datos.recibidoPorAdminId) throw new Error("Falta quién recibió el efectivo");

  const asientoId = await registrarAsiento(tx, actor, {
    fecha: datos.fecha,
    descripcion: `Cuota ${meses} – ${jugador.nombre ?? "Jugador"} ${jugador.apellido ?? ""}`.trim(),
    origen: "PAGO",
    lineas: [
      { cuentaCodigo: datos.medio === "EFECTIVO" ? codigoEfectivo(datos.recibidoPorAdminId ?? "") : "CUENTA", montoCentavos: monto },
      { cuentaCodigo: "INGRESO:CUOTAS", montoCentavos: -monto },
    ],
  });
  const [pago] = await tx
    .insert(pagos)
    .values({
      origen: "CUOTA",
      montoCentavos: monto,
      medio: datos.medio,
      fecha: datos.fecha,
      jugadorId: datos.jugadorId,
      nota: datos.nota ?? null,
      recibidoPorAdminId: datos.medio === "EFECTIVO" ? (datos.recibidoPorAdminId ?? null) : null,
      registradoPorAdminId: actor.tipo === "ADMIN" ? actor.adminId : null,
      asientoId,
    })
    .returning();
  if (!pago) throw new Error("No se pudo registrar el pago");
  const actualizados = await tx
    .update(cargos)
    .set({ estado: "PAGADO", pagoId: pago.id })
    .where(and(inArray(cargos.id, datos.cuotas.map((c) => c.id)), eq(cargos.estado, "PENDIENTE"), eq(cargos.jugadorId, datos.jugadorId)))
    .returning({ id: cargos.id });
  if (actualizados.length !== datos.cuotas.length) throw new ErrorNegocio(409, "CUOTA_CAMBIO", "Alguna de esas cuotas cambió recién. Probá de nuevo.");
  await registrarAuditoria(tx, actor, {
    accion: "CUOTAS_PAGADAS",
    entidad: "pago",
    entidadId: pago.id,
    despues: { jugadorId: datos.jugadorId, medio: datos.medio, montoCentavos: monto.toString(), cuotas: datos.cuotas.map((c) => c.id) },
  });
  return pago;
}

/** Un admin cobra en efectivo una o más cuotas pendientes de un jugador. El efectivo queda a su cargo. */
export async function cobrarCuotasEnEfectivo(db: BaseDeDatos, actor: ActorAdmin, jugadorId: string, cargoIds: string[], nota?: string) {
  const elegidas = new Set(cargoIds);
  if (elegidas.size === 0) throw new ErrorNegocio(400, "SIN_CUOTAS", "Elegí al menos una cuota.");
  return db.transaction(async (tx) => {
    await buscarJugadorActivo(tx, jugadorId);
    const pendientes = await pendientesBloqueadas(tx, jugadorId);
    const cuotas = pendientes.filter((c) => elegidas.has(c.id));
    if (cuotas.length !== elegidas.size) throw new ErrorNegocio(409, "NO_PENDIENTE", "Alguna de esas cuotas ya no está pendiente.");
    return registrarPagoDeCuotas(tx, actor, {
      jugadorId,
      cuotas,
      medio: "EFECTIVO",
      fecha: new Date(),
      recibidoPorAdminId: actor.adminId,
      ...(nota?.trim() ? { nota: nota.trim().slice(0, 300) } : {}),
    });
  });
}

/**
 * Para la verificación automática: ¿qué cuotas cancela un monto exacto?
 * Solo si es la cuota más vieja, o la suma exacta de las N más viejas (del más viejo al más nuevo).
 */
export function cuotasQueCancela<T extends { montoCentavos: bigint }>(pendientesDeMasViejaAMasNueva: T[], monto: bigint): T[] | null {
  let suma = 0n;
  for (let i = 0; i < pendientesDeMasViejaAMasNueva.length; i++) {
    suma += (pendientesDeMasViejaAMasNueva[i] as T).montoCentavos;
    if (suma === monto) return pendientesDeMasViejaAMasNueva.slice(0, i + 1);
    if (suma > monto) return null;
  }
  return null;
}

/** Al anular un pago de cuotas, sus cuotas vuelven a estar pendientes (dentro de la misma transacción). */
export async function liberarCuotasDelPago(tx: Transaccion, pagoId: string) {
  await tx.update(cargos).set({ estado: "PENDIENTE", pagoId: null }).where(eq(cargos.pagoId, pagoId));
}

/** Al eliminar (anonimizar) un jugador, sus cuotas pendientes se anulan. */
export async function anularPendientesDeJugadorEliminado(tx: Transaccion, jugadorId: string) {
  await tx
    .update(cargos)
    .set({ estado: "ANULADO", motivoAnulacion: "Jugador eliminado", anuladoEn: new Date() })
    .where(and(eq(cargos.jugadorId, jugadorId), eq(cargos.estado, "PENDIENTE")));
}

// ---------------------------------------------------------------------------
// Quién debe
// ---------------------------------------------------------------------------

/** Jugadores activos con cuotas pendientes (de todos los meses, o de uno). */
export async function deudores(db: BaseDeDatos, periodoId?: string) {
  const filas = await db
    .select({
      jugadorId: jugadores.id,
      nombre: jugadores.nombre,
      apellido: jugadores.apellido,
      telefono: jugadores.telefono,
      camada: jugadores.camada,
      cargoId: cargos.id,
      montoCentavos: cargos.montoCentavos,
      anio: periodosCuota.anio,
      mes: periodosCuota.mes,
    })
    .from(cargos)
    .innerJoin(jugadores, eq(jugadores.id, cargos.jugadorId))
    .innerJoin(periodosCuota, eq(periodosCuota.id, cargos.periodoId))
    .where(and(eq(cargos.estado, "PENDIENTE"), eq(jugadores.estado, "ACTIVO"), ...(periodoId ? [eq(cargos.periodoId, periodoId)] : [])))
    .orderBy(asc(jugadores.apellido), asc(jugadores.nombre), asc(periodosCuota.anio), asc(periodosCuota.mes));
  const porJugador = new Map<string, { jugadorId: string; nombre: string; apellido: string; telefono: string | null; camada: string | null; cuotas: { cargoId: string; mes: string; montoCentavos: bigint }[]; totalCentavos: bigint }>();
  for (const f of filas) {
    const actual = porJugador.get(f.jugadorId) ?? {
      jugadorId: f.jugadorId,
      nombre: f.nombre ?? "",
      apellido: f.apellido ?? "",
      telefono: f.telefono,
      camada: f.camada,
      cuotas: [],
      totalCentavos: 0n,
    };
    actual.cuotas.push({ cargoId: f.cargoId, mes: conMayuscula(nombreDelMes(f.anio, f.mes)), montoCentavos: f.montoCentavos });
    actual.totalCentavos += f.montoCentavos;
    porJugador.set(f.jugadorId, actual);
  }
  const lista = [...porJugador.values()];
  return { deudores: lista, totalCentavos: sumarCentavos(lista.map((d) => d.totalCentavos)) };
}

// ---------------------------------------------------------------------------
// Alias del plantel (para mostrarlo en los recordatorios)
// ---------------------------------------------------------------------------

const PARAMETRO_ALIAS = "alias_plantel";

export async function aliasDelPlantel(db: Ejecutor): Promise<string | null> {
  const [fila] = await db.select().from(parametros).where(eq(parametros.clave, PARAMETRO_ALIAS)).limit(1);
  return fila?.valor ?? null;
}

export async function fijarAlias(db: BaseDeDatos, actor: ActorAdmin, alias: string) {
  if (actor.rol !== "DUENO") throw soloDueno("cambiar el alias del plantel");
  const limpio = alias.trim();
  if (!/^[A-Za-z0-9.-]{6,20}$/.test(limpio)) {
    throw new ErrorNegocio(400, "ALIAS_INVALIDO", "El alias tiene que tener entre 6 y 20 letras, números, puntos o guiones.");
  }
  await db.transaction(async (tx) => {
    const antes = await aliasDelPlantel(tx);
    await tx
      .insert(parametros)
      .values({ clave: PARAMETRO_ALIAS, valor: limpio, actualizadoPorAdminId: actor.adminId })
      .onConflictDoUpdate({ target: parametros.clave, set: { valor: limpio, actualizadoPorAdminId: actor.adminId, actualizadoEn: new Date() } });
    await registrarAuditoria(tx, actor, { accion: "ALIAS_CAMBIADO", entidad: "parametro", entidadId: PARAMETRO_ALIAS, antes: { alias: antes }, despues: { alias: limpio } });
  });
}
