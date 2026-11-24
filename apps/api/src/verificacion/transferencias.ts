/**
 * Verificación automática de transferencias por DNI (etapa 8.2, decisión del dueño del 24/11/2026).
 *
 * Cada tanto (un servicio externo gratis la llama cada 10 minutos, y también cuando alguien abre la app),
 * la app lee las entradas nuevas de la cuenta de Mercado Pago, posteriores a la fecha de corte:
 *  - Toma el DNI de adentro del CUIL de quien transfirió.
 *  - Si es el DNI de UN jugador activo y el monto es exactamente su cuota más vieja (o la suma exacta de
 *    sus cuotas más viejas), registra el pago solo: pago + libro de caja + cuotas pagadas, todo junto.
 *  - Si no, la deja en "Revisar" para que el dueño diga de quién es.
 * Cada transferencia se guarda una sola vez (su número de Mercado Pago es la clave): nunca se usa dos veces.
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { dniDeCuil, formatearPesos, sumarCentavos } from "@3t/shared";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import { registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import { cuotasQueCancela, pendientesBloqueadas, registrarPagoDeCuotas } from "../cuotas/cuotas.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { comprasEntradas, jugadores, pagos, parametros, transferenciasRecibidas } from "../db/esquema.js";
import { comprasPendientesQueCoinciden, confirmarCompra } from "../fiestas/fiestas.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import type { EntradaCuenta } from "./cruce.js";

type Transferencia = typeof transferenciasRecibidas.$inferSelect;
export type BuscarEntradas = (desde: Date, hasta: Date) => Promise<EntradaCuenta[]>;

const SISTEMA = { tipo: "SISTEMA" as const };
const PARAMETRO_CORTE = "fecha_corte_mp";
const PARAMETRO_ULTIMA = "ultima_lectura_mp";
const SOLAPAMIENTO_MS = 2 * 24 * 3600_000;
/** Si alguien abre la app, no se vuelve a leer la cuenta si se leyó hace menos de esto. */
export const ESPERA_ENTRE_LECTURAS_MS = 2 * 60_000;

// ---------------------------------------------------------------------------
// Configuración: fecha de corte y última lectura
// ---------------------------------------------------------------------------

async function leerParametro(db: Ejecutor, clave: string): Promise<string | null> {
  const [fila] = await db.select().from(parametros).where(eq(parametros.clave, clave)).limit(1);
  return fila?.valor ?? null;
}

async function guardarParametro(db: Ejecutor, clave: string, valor: string, adminId: string | null) {
  await db
    .insert(parametros)
    .values({ clave, valor, actualizadoPorAdminId: adminId })
    .onConflictDoUpdate({ target: parametros.clave, set: { valor, actualizadoPorAdminId: adminId, actualizadoEn: new Date() } });
}

export async function estadoLectura(db: Ejecutor) {
  const corte = await leerParametro(db, PARAMETRO_CORTE);
  const ultima = await leerParametro(db, PARAMETRO_ULTIMA);
  return { fechaCorte: corte, ultimaLectura: ultima };
}

/**
 * El dueño fija desde qué día la cuenta es solo del plantel (AAAA-MM-DD, hora de Argentina).
 * Todo lo anterior se ignora. Solo se puede mover hacia adelante si ya se leyeron transferencias.
 */
export async function fijarFechaCorte(db: BaseDeDatos, actor: ActorAdmin, fecha: string) {
  if (actor.rol !== "DUENO") throw soloDueno("fijar la fecha de corte de la cuenta");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(new Date(`${fecha}T00:00:00-03:00`).getTime())) {
    throw new ErrorNegocio(400, "FECHA_INVALIDA", "La fecha no es válida.");
  }
  await db.transaction(async (tx) => {
    const antes = await leerParametro(tx, PARAMETRO_CORTE);
    const [previa] = await tx.select({ id: transferenciasRecibidas.mpPagoId }).from(transferenciasRecibidas).limit(1);
    if (previa && antes && fecha < antes) {
      throw new ErrorNegocio(409, "CORTE_HACIA_ATRAS", "Ya se leyeron transferencias: la fecha de corte no se puede mover hacia atrás.");
    }
    await guardarParametro(tx, PARAMETRO_CORTE, fecha, actor.adminId);
    await registrarAuditoria(tx, actor, { accion: "FECHA_CORTE_FIJADA", entidad: "parametro", entidadId: PARAMETRO_CORTE, antes: { fecha: antes }, despues: { fecha } });
  });
}

// ---------------------------------------------------------------------------
// Lectura de la cuenta
// ---------------------------------------------------------------------------

export type ResultadoLectura =
  | { estado: "SIN_CONFIGURAR"; motivo: string }
  | { estado: "RECIENTE"; ultimaLectura: string }
  | { estado: "LEIDA"; nuevas: number; confirmadas: number; paraRevisar: number; ultimaLectura: string };

let leyendo: Promise<ResultadoLectura> | null = null;

/** Lee la cuenta. Si ya hay una lectura en curso, espera esa misma (nunca dos a la vez en este servidor). */
export function leerCuenta(db: BaseDeDatos, buscar: BuscarEntradas | null, opciones: { ahora?: Date; siNoSeLeyoHace?: number } = {}): Promise<ResultadoLectura> {
  if (leyendo) return leyendo;
  leyendo = leerCuentaSinRepetir(db, buscar, opciones).finally(() => {
    leyendo = null;
  });
  return leyendo;
}

async function leerCuentaSinRepetir(db: BaseDeDatos, buscar: BuscarEntradas | null, opciones: { ahora?: Date; siNoSeLeyoHace?: number }): Promise<ResultadoLectura> {
  if (!buscar) return { estado: "SIN_CONFIGURAR", motivo: "La app no está conectada a Mercado Pago (falta MP_ACCESS_TOKEN)." };
  const { fechaCorte, ultimaLectura } = await estadoLectura(db);
  if (!fechaCorte) return { estado: "SIN_CONFIGURAR", motivo: "Falta la fecha de corte: desde qué día la cuenta es solo del plantel." };
  const ahora = opciones.ahora ?? new Date();
  if (opciones.siNoSeLeyoHace !== undefined && ultimaLectura && ahora.getTime() - new Date(ultimaLectura).getTime() < opciones.siNoSeLeyoHace) {
    return { estado: "RECIENTE", ultimaLectura };
  }

  const corte = new Date(`${fechaCorte}T00:00:00-03:00`);
  const desde = new Date(Math.max(corte.getTime(), ultimaLectura ? new Date(ultimaLectura).getTime() - SOLAPAMIENTO_MS : 0));
  // Mercado Pago se consulta fuera de cualquier transacción: puede tardar.
  const entradas = (await buscar(desde, ahora)).filter((e) => e.fecha >= corte).sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  const yaLeidas = new Set<string>();
  if (entradas.length > 0) {
    const filas = await db
      .select({ id: transferenciasRecibidas.mpPagoId })
      .from(transferenciasRecibidas)
      .where(inArray(transferenciasRecibidas.mpPagoId, entradas.map((e) => e.mpPagoId)));
    for (const f of filas) yaLeidas.add(f.id);
  }

  let nuevas = 0;
  let confirmadas = 0;
  let paraRevisar = 0;
  for (const entrada of entradas) {
    if (yaLeidas.has(entrada.mpPagoId)) continue;
    const resultado = await procesarEntrada(db, entrada);
    if (resultado === "YA_ESTABA") continue;
    nuevas++;
    if (resultado === "CONFIRMADA") confirmadas++;
    else paraRevisar++;
  }
  const marca = ahora.toISOString();
  await guardarParametro(db, PARAMETRO_ULTIMA, marca, null);
  return { estado: "LEIDA", nuevas, confirmadas, paraRevisar, ultimaLectura: marca };
}

/** Procesa una entrada nueva en su propia transacción. */
async function procesarEntrada(db: BaseDeDatos, entrada: EntradaCuenta): Promise<"CONFIRMADA" | "REVISAR" | "YA_ESTABA"> {
  return db.transaction(async (tx) => {
    const dni = dniDeCuil(entrada.cuitPagador);
    const [guardada] = await tx
      .insert(transferenciasRecibidas)
      .values({
        mpPagoId: entrada.mpPagoId,
        e2eId: entrada.e2eId,
        montoCentavos: entrada.montoCentavos,
        fecha: entrada.fecha,
        cuitPagador: entrada.cuitPagador,
        dniPagador: dni,
        estado: "REVISAR",
      })
      .onConflictDoNothing()
      .returning();
    if (!guardada) return "YA_ESTABA";

    const revisar = async (motivo: string, jugadorSugeridoId: string | null = null) => {
      await tx
        .update(transferenciasRecibidas)
        .set({ motivoRevision: motivo, jugadorSugeridoId })
        .where(eq(transferenciasRecibidas.mpPagoId, entrada.mpPagoId));
      return "REVISAR" as const;
    };

    if (!dni) return revisar("No trae un CUIL/CUIT válido de quien transfirió.");

    // ¿Es una compra de entradas? (DNI de quien compra y total exacto)
    const compras = await comprasPendientesQueCoinciden(tx, dni, entrada.montoCentavos);
    // ¿Es una cuota? (DNI de un jugador activo y su cuota más vieja, o la suma exacta de las más viejas)
    const [jugador] = await tx.select().from(jugadores).where(eq(jugadores.dni, dni)).limit(1);
    const nombre = jugador ? `${jugador.nombre} ${jugador.apellido}` : "";
    const pendientes = jugador?.estado === "ACTIVO" ? await pendientesBloqueadas(tx, jugador.id) : [];
    const cuotas = jugador?.estado === "ACTIVO" ? cuotasQueCancela(pendientes, entrada.montoCentavos) : null;

    if (compras.length > 1) return revisar("Hay más de una compra de entradas pendiente de ese DNI por ese mismo total.");
    const compra = compras[0];
    if (compra && cuotas) return revisar(`Puede ser la cuota de ${nombre} o su compra de entradas: decidí vos.`, jugador?.id ?? null);
    if (compra) {
      const pago = await confirmarCompra(tx, SISTEMA, compra.id, { fecha: entrada.fecha, nota: `Transferencia ${entrada.mpPagoId}` });
      await tx
        .update(transferenciasRecibidas)
        .set({ estado: "CONFIRMADA", resolucion: "ENTRADAS_AUTO", pagoId: pago.id })
        .where(eq(transferenciasRecibidas.mpPagoId, entrada.mpPagoId));
      return "CONFIRMADA";
    }

    if (!jugador) {
      const [otraCompra] = await tx
        .select({ total: comprasEntradas.totalCentavos })
        .from(comprasEntradas)
        .where(and(eq(comprasEntradas.dniPagador, dni), eq(comprasEntradas.estado, "PENDIENTE_PAGO")))
        .limit(1);
      if (otraCompra) {
        return revisar(`Ese DNI tiene una compra de entradas pendiente por ${formatearPesos(otraCompra.total)}, pero transfirió ${formatearPesos(entrada.montoCentavos)}.`);
      }
      return revisar("El DNI no es de ningún jugador ni de una compra de entradas. ¿Pagó desde la cuenta de otra persona?");
    }
    if (jugador.estado !== "ACTIVO") return revisar(`El DNI es de ${nombre}, que está de baja.`, jugador.id);
    if (!cuotas) {
      const debe = sumarCentavos(pendientes.map((c) => c.montoCentavos));
      return revisar(
        pendientes.length === 0
          ? `Es de ${nombre}, pero no debe ninguna cuota.`
          : `Es de ${nombre}, pero transfirió ${formatearPesos(entrada.montoCentavos)} y debe ${formatearPesos(debe)} (${pendientes.length} ${pendientes.length === 1 ? "cuota" : "cuotas"}).`,
        jugador.id,
      );
    }
    const pago = await registrarPagoDeCuotas(tx, SISTEMA, { jugadorId: jugador.id, cuotas, medio: "TRANSFERENCIA", fecha: entrada.fecha, nota: `Transferencia ${entrada.mpPagoId}` });
    await tx
      .update(transferenciasRecibidas)
      .set({ estado: "CONFIRMADA", resolucion: "CUOTA_AUTO", pagoId: pago.id })
      .where(eq(transferenciasRecibidas.mpPagoId, entrada.mpPagoId));
    return "CONFIRMADA";
  });
}

// ---------------------------------------------------------------------------
// "Revisar": el dueño dice de quién es cada transferencia
// ---------------------------------------------------------------------------

export async function transferenciasParaRevisar(db: BaseDeDatos) {
  const filas = await db
    .select({ t: transferenciasRecibidas, nombre: jugadores.nombre, apellido: jugadores.apellido })
    .from(transferenciasRecibidas)
    .leftJoin(jugadores, eq(jugadores.id, transferenciasRecibidas.jugadorSugeridoId))
    .where(eq(transferenciasRecibidas.estado, "REVISAR"))
    .orderBy(asc(transferenciasRecibidas.fecha));
  return filas.map(({ t, nombre, apellido }) => ({
    mpPagoId: t.mpPagoId,
    montoCentavos: t.montoCentavos,
    fecha: t.fecha.toISOString(),
    cuitPagador: t.cuitPagador,
    dniPagador: t.dniPagador,
    motivo: t.motivoRevision,
    jugadorSugerido: t.jugadorSugeridoId && nombre ? { id: t.jugadorSugeridoId, nombre: `${nombre} ${apellido}` } : null,
  }));
}

export async function cantidadParaRevisar(db: BaseDeDatos): Promise<number> {
  const filas = await db.select({ id: transferenciasRecibidas.mpPagoId }).from(transferenciasRecibidas).where(eq(transferenciasRecibidas.estado, "REVISAR"));
  return filas.length;
}

/** Últimas transferencias leídas (para ver qué reconoció la app sola). */
export async function ultimasTransferencias(db: BaseDeDatos, dias = 30) {
  const desde = new Date(Date.now() - dias * 24 * 3600_000);
  const filas = await db
    .select({ t: transferenciasRecibidas, nombre: jugadores.nombre, apellido: jugadores.apellido })
    .from(transferenciasRecibidas)
    .leftJoin(pagos, eq(pagos.id, transferenciasRecibidas.pagoId))
    .leftJoin(jugadores, eq(jugadores.id, pagos.jugadorId))
    .where(gte(transferenciasRecibidas.fecha, desde))
    .orderBy(desc(transferenciasRecibidas.fecha))
    .limit(100);
  return filas.map(({ t, nombre, apellido }) => ({
    mpPagoId: t.mpPagoId,
    montoCentavos: t.montoCentavos,
    fecha: t.fecha.toISOString(),
    estado: t.estado,
    resolucion: t.resolucion,
    jugador: nombre ? `${nombre} ${apellido}` : null,
    nota: t.nota,
  }));
}

async function enRevision(tx: Transaccion, mpPagoId: string): Promise<Transferencia> {
  const [t] = await tx.select().from(transferenciasRecibidas).where(eq(transferenciasRecibidas.mpPagoId, mpPagoId)).for("update");
  if (!t) throw noExiste("La transferencia");
  if (t.estado !== "REVISAR") throw new ErrorNegocio(409, "YA_RESUELTA", "Esa transferencia ya está resuelta.");
  return t;
}

const exigirDueno = (actor: ActorAdmin) => {
  if (actor.rol !== "DUENO") throw soloDueno("resolver transferencias");
};

/** Es de un jugador: el dueño elige qué cuotas paga. Tienen que sumar exactamente lo transferido. */
export async function asignarAJugador(db: BaseDeDatos, actor: ActorAdmin, mpPagoId: string, jugadorId: string, cargoIds: string[]) {
  exigirDueno(actor);
  const elegidas = new Set(cargoIds);
  return db.transaction(async (tx) => {
    const t = await enRevision(tx, mpPagoId);
    const [jugador] = await tx.select().from(jugadores).where(eq(jugadores.id, jugadorId)).limit(1);
    if (!jugador || jugador.estado === "ELIMINADO") throw noExiste("El jugador");
    const pendientes = await pendientesBloqueadas(tx, jugadorId);
    const cuotas = pendientes.filter((c) => elegidas.has(c.id));
    if (cuotas.length === 0 || cuotas.length !== elegidas.size) throw new ErrorNegocio(409, "NO_PENDIENTE", "Elegí cuotas pendientes de ese jugador.");
    const suma = sumarCentavos(cuotas.map((c) => c.montoCentavos));
    if (suma !== t.montoCentavos) {
      throw new ErrorNegocio(
        409,
        "MONTO_DISTINTO",
        `Las cuotas elegidas suman ${formatearPesos(suma)} y la transferencia es de ${formatearPesos(t.montoCentavos)}. No hay pagos parciales.`,
      );
    }
    const pago = await registrarPagoDeCuotas(tx, actor, { jugadorId, cuotas, medio: "TRANSFERENCIA", fecha: t.fecha, nota: `Transferencia ${t.mpPagoId}` });
    await tx
      .update(transferenciasRecibidas)
      .set({ estado: "RESUELTA", resolucion: "CUOTA_MANUAL", pagoId: pago.id, resueltoPorAdminId: actor.adminId, resueltoEn: new Date() })
      .where(eq(transferenciasRecibidas.mpPagoId, mpPagoId));
    return pago;
  });
}

/** Es una compra de entradas: el dueño elige cuál (tiene que ser por el mismo total). */
export async function asignarACompra(db: BaseDeDatos, actor: ActorAdmin, mpPagoId: string, compraId: string) {
  exigirDueno(actor);
  return db.transaction(async (tx) => {
    const t = await enRevision(tx, mpPagoId);
    const [compra] = await tx.select().from(comprasEntradas).where(eq(comprasEntradas.id, compraId)).limit(1);
    if (!compra) throw noExiste("La compra");
    if (compra.totalCentavos !== t.montoCentavos) {
      throw new ErrorNegocio(409, "MONTO_DISTINTO", `La compra es por ${formatearPesos(compra.totalCentavos)} y la transferencia por ${formatearPesos(t.montoCentavos)}.`);
    }
    const pago = await confirmarCompra(tx, actor, compraId, { fecha: t.fecha, nota: `Transferencia ${t.mpPagoId}` });
    await tx
      .update(transferenciasRecibidas)
      .set({ estado: "RESUELTA", resolucion: "ENTRADAS_MANUAL", pagoId: pago.id, resueltoPorAdminId: actor.adminId, resueltoEn: new Date() })
      .where(eq(transferenciasRecibidas.mpPagoId, mpPagoId));
    return pago;
  });
}

/** Ya está cargada en la app (un depósito de efectivo o un invitado que pagó por transferencia): no suma de nuevo. */
export async function marcarYaRegistrada(db: BaseDeDatos, actor: ActorAdmin, mpPagoId: string, nota: string) {
  exigirDueno(actor);
  return resolverSinPago(db, actor, mpPagoId, "YA_REGISTRADA", nota);
}

/** No es plata del plantel: no entra a la caja (el dueño la tiene que sacar de la cuenta). */
export async function marcarNoEsDelPlantel(db: BaseDeDatos, actor: ActorAdmin, mpPagoId: string, nota: string) {
  exigirDueno(actor);
  return resolverSinPago(db, actor, mpPagoId, "NO_ES_DEL_PLANTEL", nota);
}

async function resolverSinPago(db: BaseDeDatos, actor: ActorAdmin, mpPagoId: string, resolucion: "YA_REGISTRADA" | "NO_ES_DEL_PLANTEL", nota: string) {
  const limpia = nota.trim();
  if (limpia.length < 3) throw new ErrorNegocio(400, "FALTA_NOTA", "Escribí una nota corta (por ejemplo, de qué es).");
  return db.transaction(async (tx) => {
    await enRevision(tx, mpPagoId);
    const [t] = await tx
      .update(transferenciasRecibidas)
      .set({ estado: "RESUELTA", resolucion, nota: limpia.slice(0, 300), resueltoPorAdminId: actor.adminId, resueltoEn: new Date() })
      .where(eq(transferenciasRecibidas.mpPagoId, mpPagoId))
      .returning();
    await registrarAuditoria(tx, actor, { accion: `TRANSFERENCIA_${resolucion}`, entidad: "transferencias_recibidas", entidadId: mpPagoId, despues: { nota: limpia } });
    return t;
  });
}

/** Otro ingreso del plantel (por ejemplo, una donación): entra a la caja como "Otros ingresos". */
export async function registrarOtroIngreso(db: BaseDeDatos, actor: ActorAdmin, mpPagoId: string, descripcion: string) {
  exigirDueno(actor);
  const limpia = descripcion.trim();
  if (limpia.length < 3) throw new ErrorNegocio(400, "FALTA_NOTA", "Escribí de qué es el ingreso.");
  return db.transaction(async (tx) => {
    const t = await enRevision(tx, mpPagoId);
    const asientoId = await registrarAsiento(tx, actor, {
      fecha: t.fecha,
      descripcion: `Transferencia recibida: ${limpia}`.slice(0, 200),
      origen: "PAGO",
      lineas: [
        { cuentaCodigo: "CUENTA", montoCentavos: t.montoCentavos },
        { cuentaCodigo: "INGRESO:OTROS", montoCentavos: -t.montoCentavos },
      ],
    });
    const [pago] = await tx
      .insert(pagos)
      .values({ origen: "OTRO", montoCentavos: t.montoCentavos, medio: "TRANSFERENCIA", fecha: t.fecha, nota: limpia.slice(0, 300), registradoPorAdminId: actor.adminId, asientoId })
      .returning();
    if (!pago) throw new Error("No se pudo registrar el ingreso");
    await tx
      .update(transferenciasRecibidas)
      .set({ estado: "RESUELTA", resolucion: "OTRO_INGRESO", pagoId: pago.id, nota: limpia.slice(0, 300), resueltoPorAdminId: actor.adminId, resueltoEn: new Date() })
      .where(eq(transferenciasRecibidas.mpPagoId, mpPagoId));
    await registrarAuditoria(tx, actor, { accion: "TRANSFERENCIA_OTRO_INGRESO", entidad: "transferencias_recibidas", entidadId: mpPagoId, despues: { pagoId: pago.id } });
    return pago;
  });
}

/**
 * Cuando el dueño anula un pago que vino de una transferencia (por ejemplo, se le asignó al jugador equivocado),
 * la transferencia vuelve a "Revisar" para asignarla bien. Corre dentro de la anulación.
 */
export async function devolverTransferenciaARevisar(tx: Transaccion, pagoId: string) {
  await tx
    .update(transferenciasRecibidas)
    .set({
      estado: "REVISAR",
      resolucion: null,
      pagoId: null,
      motivoRevision: "Se anuló el pago al que estaba asignada: hay que volver a decir de quién es.",
      resueltoPorAdminId: null,
      resueltoEn: null,
    })
    .where(eq(transferenciasRecibidas.pagoId, pagoId));
}
