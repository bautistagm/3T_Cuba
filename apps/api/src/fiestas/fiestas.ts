/**
 * Fiestas (etapa 9.1).
 *
 * - El dueño crea la fiesta con un precio por tipo de entrada (por defecto "Mujer" y "Hombre"). Sin cupos.
 * - Cada tipo tiene su link público de venta. Quien compra carga una o varias entradas (cada una con nombre
 *   y DNI) y transfiere el total desde su cuenta. La app reconoce la transferencia por el DNI de quien compra
 *   (la primera entrada) y el total exacto, igual que las cuotas (ver verificacion/transferencias.ts).
 * - Cada entrada tiene un código aleatorio (el QR). Se marca usada en la puerta (etapa 9.3).
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { normalizarDni } from "@3t/shared";
import { z } from "zod";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import { registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import { aliasDelPlantel } from "../cuotas/cuotas.js";
import type { BaseDeDatos, Ejecutor, Transaccion } from "../db/cliente.js";
import { comprasEntradas, entradas, fiestas, pagos, tandas, tiposEntrada } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { anotarEmailDeEntradas } from "../email/entradas.js";

type Compra = typeof comprasEntradas.$inferSelect;
const token = (bytes: number) => randomBytes(bytes).toString("base64url");
const MAXIMO_POR_COMPRA = 10;

// ---------------------------------------------------------------------------
// El dueño crea y maneja la fiesta
// ---------------------------------------------------------------------------

export const nuevaFiestaSchema = z.object({
  nombre: z.string().trim().min(2, "Poné el nombre o motivo de la fiesta.").max(80),
  fechaHora: z.coerce.date({ invalid_type_error: "La fecha no es válida." }),
  lugar: z.string().trim().max(120).optional(),
  tipos: z
    .array(z.object({ nombre: z.string().trim().min(1).max(30), precioCentavos: z.coerce.bigint().positive("El precio tiene que ser mayor a cero.") }))
    .min(1, "Tiene que haber al menos un tipo de entrada.")
    .max(6),
});

export async function crearFiesta(db: BaseDeDatos, actor: ActorAdmin, datos: z.infer<typeof nuevaFiestaSchema>) {
  if (actor.rol !== "DUENO") throw soloDueno("crear fiestas");
  const nombres = new Set(datos.tipos.map((t) => t.nombre.toLowerCase()));
  if (nombres.size !== datos.tipos.length) throw new ErrorNegocio(400, "TIPO_REPETIDO", "Hay dos tipos de entrada con el mismo nombre.");
  return db.transaction(async (tx) => {
    const [fiesta] = await tx
      .insert(fiestas)
      .values({ nombre: datos.nombre, fechaHora: datos.fechaHora, lugar: datos.lugar?.trim() || null, tokenPuerta: token(24), creadaPorAdminId: actor.adminId })
      .returning();
    if (!fiesta) throw new Error("No se pudo crear la fiesta");
    await tx.insert(tiposEntrada).values(
      datos.tipos.map((t, i) => ({ fiestaId: fiesta.id, nombre: t.nombre, precioCentavos: t.precioCentavos, tokenVenta: token(12), orden: i })),
    );
    await registrarAuditoria(tx, actor, {
      accion: "FIESTA_CREADA",
      entidad: "fiestas",
      entidadId: fiesta.id,
      despues: { nombre: datos.nombre, tipos: datos.tipos.map((t) => ({ nombre: t.nombre, precioCentavos: t.precioCentavos.toString() })) },
    });
    return fiesta;
  });
}

export async function cambiarEstadoVenta(db: BaseDeDatos, actor: ActorAdmin, fiestaId: string, abierta: boolean) {
  if (actor.rol !== "DUENO") throw soloDueno(abierta ? "abrir la venta" : "cerrar la venta");
  return db.transaction(async (tx) => {
    const [f] = await tx
      .update(fiestas)
      .set({ estado: abierta ? "A_LA_VENTA" : "VENTA_CERRADA" })
      .where(eq(fiestas.id, fiestaId))
      .returning();
    if (!f) throw noExiste("La fiesta");
    await registrarAuditoria(tx, actor, { accion: abierta ? "FIESTA_VENTA_ABIERTA" : "FIESTA_VENTA_CERRADA", entidad: "fiestas", entidadId: fiestaId });
    return f;
  });
}

/** Si el link de puerta se filtró, el dueño lo cambia: el anterior deja de andar. */
export async function nuevoLinkDePuerta(db: BaseDeDatos, actor: ActorAdmin, fiestaId: string) {
  if (actor.rol !== "DUENO") throw soloDueno("cambiar el link de puerta");
  return db.transaction(async (tx) => {
    const [f] = await tx.update(fiestas).set({ tokenPuerta: token(24) }).where(eq(fiestas.id, fiestaId)).returning();
    if (!f) throw noExiste("La fiesta");
    await registrarAuditoria(tx, actor, { accion: "FIESTA_LINK_PUERTA_NUEVO", entidad: "fiestas", entidadId: fiestaId });
    return f;
  });
}

export async function listarFiestas(db: BaseDeDatos) {
  const filas = await db
    .select({
      fiesta: fiestas,
      vendidas: sql<number>`count(${entradas.id}) filter (where ${entradas.estado} in ('VALIDA', 'USADA'))`.mapWith(Number),
      usadas: sql<number>`count(${entradas.id}) filter (where ${entradas.estado} = 'USADA')`.mapWith(Number),
      pendientes: sql<number>`count(${entradas.id}) filter (where ${entradas.estado} = 'PENDIENTE_PAGO')`.mapWith(Number),
    })
    .from(fiestas)
    .leftJoin(entradas, eq(entradas.fiestaId, fiestas.id))
    .groupBy(fiestas.id)
    .orderBy(desc(fiestas.fechaHora));
  return filas.map((f) => ({
    id: f.fiesta.id,
    nombre: f.fiesta.nombre,
    fechaHora: f.fiesta.fechaHora.toISOString(),
    lugar: f.fiesta.lugar,
    estado: f.fiesta.estado,
    vendidas: f.vendidas,
    usadas: f.usadas,
    pendientes: f.pendientes,
  }));
}

export async function detalleFiesta(db: BaseDeDatos, fiestaId: string, actor: ActorAdmin) {
  const [fiesta] = await db.select().from(fiestas).where(eq(fiestas.id, fiestaId)).limit(1);
  if (!fiesta) throw noExiste("La fiesta");
  const tipos = await db.select().from(tiposEntrada).where(eq(tiposEntrada.fiestaId, fiestaId)).orderBy(asc(tiposEntrada.orden));
  const todasLasTandas = tipos.length
    ? await db.select().from(tandas).where(inArray(tandas.tipoId, tipos.map((t) => t.id))).orderBy(asc(tandas.hasta))
    : [];
  const ahora = new Date();
  const lista = await db
    .select({ e: entradas, email: comprasEntradas.email, telefono: comprasEntradas.telefono, pagadaEn: pagos.fecha })
    .from(entradas)
    .innerJoin(comprasEntradas, eq(comprasEntradas.id, entradas.compraId))
    .leftJoin(pagos, and(eq(pagos.id, comprasEntradas.pagoId), eq(pagos.estado, "CONFIRMADO")))
    .where(eq(entradas.fiestaId, fiestaId))
    .orderBy(asc(entradas.nombre));
  const recaudado = await db
    .select({ total: sql<string>`coalesce(sum(${pagos.montoCentavos}), 0)` })
    .from(comprasEntradas)
    .innerJoin(pagos, eq(pagos.id, comprasEntradas.pagoId))
    .where(and(eq(comprasEntradas.fiestaId, fiestaId), eq(pagos.estado, "CONFIRMADO")));
  return {
    fiesta: {
      id: fiesta.id,
      nombre: fiesta.nombre,
      fechaHora: fiesta.fechaHora.toISOString(),
      lugar: fiesta.lugar,
      estado: fiesta.estado,
      // El link de puerta lo ve solo el dueño (es quien lo comparte).
      tokenPuerta: actor.rol === "DUENO" ? fiesta.tokenPuerta : null,
    },
    tipos: tipos.map((t) => {
      const suyas = todasLasTandas.filter((x) => x.tipoId === t.id);
      return {
        id: t.id,
        nombre: t.nombre,
        precioCentavos: t.precioCentavos,
        precioVigenteCentavos: suyas.find((x) => x.hasta > ahora)?.precioCentavos ?? t.precioCentavos,
        tokenVenta: t.tokenVenta,
        tandas: suyas.map((x) => ({ id: x.id, precioCentavos: x.precioCentavos, hasta: x.hasta.toISOString(), termino: x.hasta <= ahora })),
      };
    }),
    entradas: lista.map(({ e, email, telefono, pagadaEn }) => ({
      pagadaEn: pagadaEn?.toISOString() ?? null,
      id: e.id,
      compraId: e.compraId,
      tipoId: e.tipoId,
      nombre: e.nombre,
      dni: e.dni,
      estado: e.estado,
      usadaEn: e.usadaEn?.toISOString() ?? null,
      usadaPor: e.usadaPor,
      email,
      telefono,
    })),
    recaudadoCentavos: BigInt(recaudado[0]?.total ?? "0"),
  };
}

export const editarFiestaSchema = z.object({
  nombre: z.string().trim().min(2, "Poné el nombre o motivo de la fiesta.").max(80),
  fechaHora: z.coerce.date({ invalid_type_error: "La fecha no es válida." }),
  lugar: z.string().trim().max(120).optional(),
  /** Los tipos que ya existen (con id) se renombran o cambian de precio; los nuevos (sin id) se agregan. */
  tipos: z
    .array(z.object({ id: z.string().uuid().optional(), nombre: z.string().trim().min(1).max(30), precioCentavos: z.coerce.bigint().positive("El precio tiene que ser mayor a cero.") }))
    .min(1)
    .max(6),
});

/**
 * Editar una fiesta (solo el dueño, decisión del 26/11/2026). Un precio nuevo vale para las compras que se carguen
 * desde ahora: las compras ya cargadas mantienen el suyo.
 */
export async function editarFiesta(db: BaseDeDatos, actor: ActorAdmin, fiestaId: string, pedido: z.input<typeof editarFiestaSchema>) {
  if (actor.rol !== "DUENO") throw soloDueno("editar fiestas");
  const datos = editarFiestaSchema.parse(pedido);
  const nombres = new Set(datos.tipos.map((t) => t.nombre.toLowerCase()));
  if (nombres.size !== datos.tipos.length) throw new ErrorNegocio(400, "TIPO_REPETIDO", "Hay dos tipos de entrada con el mismo nombre.");
  return db.transaction(async (tx) => {
    const [fiesta] = await tx.select().from(fiestas).where(eq(fiestas.id, fiestaId)).for("update");
    if (!fiesta) throw noExiste("La fiesta");
    const actuales = await tx.select().from(tiposEntrada).where(eq(tiposEntrada.fiestaId, fiestaId)).orderBy(asc(tiposEntrada.orden));
    for (const t of datos.tipos) {
      if (t.id && !actuales.some((a) => a.id === t.id)) throw noExiste("El tipo de entrada");
    }
    if (actuales.some((a) => !datos.tipos.some((t) => t.id === a.id))) {
      throw new ErrorNegocio(400, "TIPO_FALTANTE", "Un tipo de entrada no se puede sacar al editar.");
    }
    const ids = actuales.map((a) => a.id);
    const ultimaTanda = ids.length
      ? (await tx.select({ hasta: sql<Date | null>`max(${tandas.hasta})` }).from(tandas).where(and(inArray(tandas.tipoId, ids), gt(tandas.hasta, new Date()))))[0]?.hasta
      : null;
    if (ultimaTanda && new Date(ultimaTanda) >= datos.fechaHora) {
      throw new ErrorNegocio(400, "FECHA_ANTES_DE_TANDA", "Hay una tanda que termina después de esa fecha: cambiá o quitá la tanda primero.");
    }

    await tx.update(fiestas).set({ nombre: datos.nombre, fechaHora: datos.fechaHora, lugar: datos.lugar?.trim() || null }).where(eq(fiestas.id, fiestaId));
    let orden = actuales.length;
    for (const t of datos.tipos) {
      if (t.id) {
        await tx.update(tiposEntrada).set({ nombre: t.nombre, precioCentavos: t.precioCentavos }).where(eq(tiposEntrada.id, t.id));
      } else {
        await tx.insert(tiposEntrada).values({ fiestaId, nombre: t.nombre, precioCentavos: t.precioCentavos, tokenVenta: token(12), orden: orden++ });
      }
    }
    await registrarAuditoria(tx, actor, {
      accion: "FIESTA_EDITADA",
      entidad: "fiestas",
      entidadId: fiestaId,
      antes: { nombre: fiesta.nombre, fechaHora: fiesta.fechaHora.toISOString(), lugar: fiesta.lugar, tipos: actuales.map((a) => ({ id: a.id, nombre: a.nombre, precioCentavos: a.precioCentavos.toString() })) },
      despues: { nombre: datos.nombre, fechaHora: datos.fechaHora.toISOString(), lugar: datos.lugar ?? null, tipos: datos.tipos.map((t) => ({ id: t.id ?? null, nombre: t.nombre, precioCentavos: t.precioCentavos.toString() })) },
    });
  });
}

// ---------------------------------------------------------------------------
// Tandas (opcionales): el dueño agrega o quita precios por fecha
// ---------------------------------------------------------------------------

export const tandaSchema = z.object({
  precioCentavos: z.coerce.bigint().positive("El precio tiene que ser mayor a cero."),
  hasta: z.coerce.date({ invalid_type_error: "La fecha no es válida." }),
});

export async function agregarTanda(db: BaseDeDatos, actor: ActorAdmin, tipoId: string, datos: z.infer<typeof tandaSchema>, ahora = new Date()) {
  if (actor.rol !== "DUENO") throw soloDueno("cambiar los precios");
  return db.transaction(async (tx) => {
    const [fila] = await tx.select({ tipo: tiposEntrada, fiesta: fiestas }).from(tiposEntrada).innerJoin(fiestas, eq(fiestas.id, tiposEntrada.fiestaId)).where(eq(tiposEntrada.id, tipoId)).limit(1);
    if (!fila) throw noExiste("El tipo de entrada");
    if (datos.hasta <= ahora) throw new ErrorNegocio(400, "TANDA_PASADA", "La tanda tiene que terminar más adelante.");
    if (datos.hasta >= fila.fiesta.fechaHora) throw new ErrorNegocio(400, "TANDA_DESPUES_DE_LA_FIESTA", "La tanda tiene que terminar antes de la fiesta.");
    const [repetida] = await tx.select().from(tandas).where(and(eq(tandas.tipoId, tipoId), eq(tandas.hasta, datos.hasta))).limit(1);
    if (repetida) throw new ErrorNegocio(409, "TANDA_REPETIDA", "Ya hay una tanda que termina en ese momento.");
    const [tanda] = await tx.insert(tandas).values({ tipoId, precioCentavos: datos.precioCentavos, hasta: datos.hasta, creadaPorAdminId: actor.adminId }).returning();
    await registrarAuditoria(tx, actor, {
      accion: "TANDA_AGREGADA",
      entidad: "tandas",
      entidadId: tanda?.id ?? "",
      despues: { tipoId, precioCentavos: datos.precioCentavos.toString(), hasta: datos.hasta.toISOString() },
    });
    return tanda;
  });
}

export async function quitarTanda(db: BaseDeDatos, actor: ActorAdmin, tandaId: string, ahora = new Date()) {
  if (actor.rol !== "DUENO") throw soloDueno("cambiar los precios");
  return db.transaction(async (tx) => {
    const [tanda] = await tx.select().from(tandas).where(eq(tandas.id, tandaId)).for("update");
    if (!tanda) throw noExiste("La tanda");
    if (tanda.hasta <= ahora) throw new ErrorNegocio(409, "TANDA_TERMINADA", "Esa tanda ya terminó: queda registrada.");
    await tx.delete(tandas).where(eq(tandas.id, tandaId));
    await registrarAuditoria(tx, actor, {
      accion: "TANDA_QUITADA",
      entidad: "tandas",
      entidadId: tandaId,
      antes: { tipoId: tanda.tipoId, precioCentavos: tanda.precioCentavos.toString(), hasta: tanda.hasta.toISOString() },
    });
  });
}

// ---------------------------------------------------------------------------
// Compra pública (link de venta)
// ---------------------------------------------------------------------------

async function tipoPorToken(db: Ejecutor, tokenVenta: string) {
  const [fila] = await db
    .select({ tipo: tiposEntrada, fiesta: fiestas })
    .from(tiposEntrada)
    .innerJoin(fiestas, eq(fiestas.id, tiposEntrada.fiestaId))
    .where(eq(tiposEntrada.tokenVenta, tokenVenta))
    .limit(1);
  if (!fila) throw new ErrorNegocio(404, "LINK_INVALIDO", "Este link de venta no existe.");
  return fila;
}

const ventaAbierta = (fiesta: typeof fiestas.$inferSelect, ahora: Date) => fiesta.estado === "A_LA_VENTA" && fiesta.fechaHora.getTime() + 6 * 3600_000 > ahora.getTime();

/** Precio de hoy: la primera tanda que no terminó; si no hay (o terminaron todas), el precio del tipo. */
async function precioVigente(db: Ejecutor, tipo: typeof tiposEntrada.$inferSelect, ahora: Date) {
  const proximas = await db.select().from(tandas).where(and(eq(tandas.tipoId, tipo.id), gt(tandas.hasta, ahora))).orderBy(asc(tandas.hasta));
  const vigente = proximas[0];
  return {
    precioCentavos: vigente?.precioCentavos ?? tipo.precioCentavos,
    /** Si hay tanda: hasta cuándo vale y cuánto sale después. */
    tanda: vigente ? { hasta: vigente.hasta.toISOString(), despuesCentavos: proximas[1]?.precioCentavos ?? tipo.precioCentavos } : null,
  };
}

export async function fiestaParaComprar(db: BaseDeDatos, tokenVenta: string) {
  const { tipo, fiesta } = await tipoPorToken(db, tokenVenta);
  const precio = await precioVigente(db, tipo, new Date());
  return {
    fiesta: { nombre: fiesta.nombre, fechaHora: fiesta.fechaHora.toISOString(), lugar: fiesta.lugar },
    tipo: { nombre: tipo.nombre, precioCentavos: precio.precioCentavos, tanda: precio.tanda },
    abierta: ventaAbierta(fiesta, new Date()),
    alias: await aliasDelPlantel(db),
  };
}

export const compraSchema = z.object({
  entradas: z
    .array(z.object({ nombre: z.string().trim().min(3, "Poné nombre y apellido.").max(80), dni: z.string().max(20) }))
    .min(1, "Cargá al menos una entrada.")
    .max(MAXIMO_POR_COMPRA, `Hasta ${MAXIMO_POR_COMPRA} entradas por compra.`),
  email: z.string().trim().toLowerCase().email("El email no es válido.").max(120),
  telefono: z.string().trim().max(30).optional(),
});

function resumenCompra(compra: Compra, alias: string | null, existente = false) {
  return {
    codigoConsulta: compra.codigoConsulta,
    cantidad: compra.cantidad,
    totalCentavos: compra.totalCentavos,
    dniPagador: compra.dniPagador,
    estado: compra.estado,
    alias,
    existente,
  };
}

export async function crearCompra(db: BaseDeDatos, tokenVenta: string, datos: z.infer<typeof compraSchema>) {
  const dnis = datos.entradas.map((e) => normalizarDni(e.dni));
  dnis.forEach((d, i) => {
    if (!d) throw new ErrorNegocio(400, "DNI_INVALIDO", `El DNI de ${datos.entradas[i]?.nombre ?? "una entrada"} no es válido (7 u 8 números).`);
  });
  const validos = dnis as string[];
  if (new Set(validos).size !== validos.length) throw new ErrorNegocio(400, "DNI_REPETIDO", "Hay dos entradas con el mismo DNI.");
  const dniPagador = validos[0] as string;

  return db.transaction(async (tx) => {
    const { tipo, fiesta } = await tipoPorToken(tx, tokenVenta);
    if (!ventaAbierta(fiesta, new Date())) throw new ErrorNegocio(409, "VENTA_CERRADA", "La venta de entradas para esta fiesta está cerrada.");
    // Quien compra solo puede tener una compra pendiente por fiesta: así la transferencia no se confunde.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`compra:${fiesta.id}:${dniPagador}`}))`);
    const [pendiente] = await tx
      .select()
      .from(comprasEntradas)
      .where(and(eq(comprasEntradas.fiestaId, fiesta.id), eq(comprasEntradas.dniPagador, dniPagador), eq(comprasEntradas.estado, "PENDIENTE_PAGO")))
      .limit(1);
    const alias = await aliasDelPlantel(tx);
    if (pendiente) return resumenCompra(pendiente, alias, true);
    const yaTienen = await tx
      .select({ dni: entradas.dni })
      .from(entradas)
      .where(and(eq(entradas.fiestaId, fiesta.id), inArray(entradas.estado, ["VALIDA", "USADA"]), inArray(entradas.dni, validos)));
    if (yaTienen.length > 0) {
      throw new ErrorNegocio(409, "YA_TIENE_ENTRADA", `El DNI ${yaTienen.map((y) => y.dni).join(", ")} ya tiene entrada para esta fiesta.`);
    }
    const { precioCentavos: precio } = await precioVigente(tx, tipo, new Date());
    const total = precio * BigInt(validos.length);
    const [compra] = await tx
      .insert(comprasEntradas)
      .values({
        fiestaId: fiesta.id,
        tipoId: tipo.id,
        dniPagador,
        email: datos.email,
        telefono: datos.telefono?.trim() || null,
        cantidad: validos.length,
        precioUnitarioCentavos: precio,
        totalCentavos: total,
        codigoConsulta: token(16),
      })
      .returning();
    if (!compra) throw new Error("No se pudo guardar la compra");
    await tx.insert(entradas).values(
      datos.entradas.map((e, i) => ({ compraId: compra.id, fiestaId: fiesta.id, tipoId: tipo.id, nombre: e.nombre.replace(/\s+/g, " "), dni: validos[i] as string, codigo: token(18) })),
    );
    return resumenCompra(compra, alias);
  });
}

/** Lo que ve quien compró, con su código de consulta. Si ya se pagó, incluye los códigos de los QR. */
export async function estadoDeCompra(db: BaseDeDatos, codigoConsulta: string) {
  const [fila] = await db
    .select({ compra: comprasEntradas, fiesta: fiestas, tipo: tiposEntrada })
    .from(comprasEntradas)
    .innerJoin(fiestas, eq(fiestas.id, comprasEntradas.fiestaId))
    .innerJoin(tiposEntrada, eq(tiposEntrada.id, comprasEntradas.tipoId))
    .where(eq(comprasEntradas.codigoConsulta, codigoConsulta))
    .limit(1);
  if (!fila) throw new ErrorNegocio(404, "NO_EXISTE", "No encontramos esa compra.");
  const lista = await db.select().from(entradas).where(eq(entradas.compraId, fila.compra.id)).orderBy(asc(entradas.creadoEn));
  const pagada = fila.compra.estado === "PAGADA";
  return {
    ...resumenCompra(fila.compra, await aliasDelPlantel(db)),
    fiesta: { nombre: fila.fiesta.nombre, fechaHora: fila.fiesta.fechaHora.toISOString(), lugar: fila.fiesta.lugar },
    tipo: fila.tipo.nombre,
    entradas: lista.map((e) => ({ nombre: e.nombre, dni: e.dni, estado: e.estado, codigo: pagada && e.estado !== "ANULADA" ? e.codigo : null })),
  };
}

// ---------------------------------------------------------------------------
// Confirmación con la transferencia (la llama la verificación automática o el dueño desde "Revisar")
// ---------------------------------------------------------------------------

/** Compras pendientes de ese DNI por ese total exacto (bloqueadas para confirmarlas). */
export async function comprasPendientesQueCoinciden(tx: Transaccion, dni: string, montoCentavos: bigint) {
  return tx
    .select()
    .from(comprasEntradas)
    .where(and(eq(comprasEntradas.dniPagador, dni), eq(comprasEntradas.totalCentavos, montoCentavos), eq(comprasEntradas.estado, "PENDIENTE_PAGO")))
    .for("update");
}

/** Compras pendientes por un total exacto (para que el dueño elija desde "Revisar"). */
export async function comprasPendientesPorMonto(db: BaseDeDatos, montoCentavos: bigint) {
  const filas = await db
    .select({ compra: comprasEntradas, fiesta: fiestas.nombre, tipo: tiposEntrada.nombre })
    .from(comprasEntradas)
    .innerJoin(fiestas, eq(fiestas.id, comprasEntradas.fiestaId))
    .innerJoin(tiposEntrada, eq(tiposEntrada.id, comprasEntradas.tipoId))
    .where(and(eq(comprasEntradas.totalCentavos, montoCentavos), eq(comprasEntradas.estado, "PENDIENTE_PAGO")))
    .orderBy(desc(comprasEntradas.creadoEn))
    .limit(20);
  const nombres = await Promise.all(
    filas.map(async (f) => (await db.select({ nombre: entradas.nombre }).from(entradas).where(eq(entradas.compraId, f.compra.id)).orderBy(asc(entradas.creadoEn)).limit(1))[0]?.nombre ?? ""),
  );
  return filas.map((f, i) => ({
    id: f.compra.id,
    fiesta: f.fiesta,
    tipo: f.tipo,
    cantidad: f.compra.cantidad,
    dniPagador: f.compra.dniPagador,
    quienCompra: nombres[i] ?? "",
    creadaEn: f.compra.creadoEn.toISOString(),
  }));
}

/** Registra el pago de una compra: pago + libro de caja + entradas válidas, todo en la misma transacción. */
export async function confirmarCompra(tx: Transaccion, actor: Actor, compraId: string, datos: { fecha: Date; nota: string }) {
  const [compra] = await tx.select().from(comprasEntradas).where(eq(comprasEntradas.id, compraId)).for("update");
  if (!compra) throw noExiste("La compra");
  if (compra.estado !== "PENDIENTE_PAGO") throw new ErrorNegocio(409, "COMPRA_NO_PENDIENTE", "Esa compra ya no está pendiente de pago.");
  const [fiesta] = await tx.select().from(fiestas).where(eq(fiestas.id, compra.fiestaId)).limit(1);
  const asientoId = await registrarAsiento(tx, actor, {
    fecha: datos.fecha,
    descripcion: `${compra.cantidad === 1 ? "Entrada" : `${compra.cantidad} entradas`} – ${fiesta?.nombre ?? "Fiesta"}`,
    origen: "PAGO",
    lineas: [
      { cuentaCodigo: "CUENTA", montoCentavos: compra.totalCentavos },
      { cuentaCodigo: "INGRESO:FIESTAS", montoCentavos: -compra.totalCentavos },
    ],
  });
  const [pago] = await tx
    .insert(pagos)
    .values({
      origen: "ENTRADA_FIESTA",
      montoCentavos: compra.totalCentavos,
      medio: "TRANSFERENCIA",
      fecha: datos.fecha,
      nota: datos.nota,
      registradoPorAdminId: actor.tipo === "ADMIN" ? actor.adminId : null,
      asientoId,
    })
    .returning();
  if (!pago) throw new Error("No se pudo registrar el pago");
  await tx.update(comprasEntradas).set({ estado: "PAGADA", pagoId: pago.id }).where(eq(comprasEntradas.id, compraId));
  await tx.update(entradas).set({ estado: "VALIDA" }).where(and(eq(entradas.compraId, compraId), eq(entradas.estado, "PENDIENTE_PAGO")));
  // El email con los QR se anota acá (misma transacción) y se manda después, con reintentos.
  await anotarEmailDeEntradas(tx, compraId, compra.email);
  await registrarAuditoria(tx, actor, {
    accion: "ENTRADAS_PAGADAS",
    entidad: "compras_entradas",
    entidadId: compraId,
    despues: { pagoId: pago.id, totalCentavos: compra.totalCentavos.toString() },
  });
  return pago;
}

/** Al anular el pago de una compra, la compra y sus entradas quedan anuladas (corre dentro de la anulación). */
export async function anularCompraDelPago(tx: Transaccion, pagoId: string) {
  const [compra] = await tx.select().from(comprasEntradas).where(eq(comprasEntradas.pagoId, pagoId)).limit(1);
  if (!compra) return;
  await tx.update(entradas).set({ estado: "ANULADA" }).where(eq(entradas.compraId, compra.id));
  await tx.update(comprasEntradas).set({ estado: "ANULADA" }).where(eq(comprasEntradas.id, compra.id));
}

/** El dueño anula una compra que nunca se pagó (por ejemplo, se cargó mal). */
export async function anularCompraPendiente(db: BaseDeDatos, actor: ActorAdmin, compraId: string) {
  if (actor.rol !== "DUENO") throw soloDueno("anular compras");
  return db.transaction(async (tx) => {
    const [compra] = await tx.select().from(comprasEntradas).where(eq(comprasEntradas.id, compraId)).for("update");
    if (!compra) throw noExiste("La compra");
    if (compra.estado !== "PENDIENTE_PAGO") throw new ErrorNegocio(409, "COMPRA_NO_PENDIENTE", "Solo se anulan acá las compras sin pagar. Si está pagada, anulá el pago.");
    await tx.update(entradas).set({ estado: "ANULADA" }).where(eq(entradas.compraId, compraId));
    await tx.update(comprasEntradas).set({ estado: "ANULADA" }).where(eq(comprasEntradas.id, compraId));
    await registrarAuditoria(tx, actor, { accion: "COMPRA_ANULADA", entidad: "compras_entradas", entidadId: compraId });
  });
}

/** CSV de la lista de una fiesta (para descargar). */
export function listaEnCsv(detalle: Awaited<ReturnType<typeof detalleFiesta>>): string {
  const tipos = new Map(detalle.tipos.map((t) => [t.id, t.nombre]));
  const ESTADOS: Record<string, string> = { VALIDA: "Pagada", USADA: "Ingresó", PENDIENTE_PAGO: "Sin pagar", ANULADA: "Anulada" };
  const celda = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const filas = [...detalle.entradas]
    .sort((a, b) => (tipos.get(a.tipoId) ?? "").localeCompare(tipos.get(b.tipoId) ?? "") || a.nombre.localeCompare(b.nombre))
    .map((e) => [tipos.get(e.tipoId) ?? "", e.nombre, e.dni, ESTADOS[e.estado] ?? e.estado, e.email, e.telefono ?? ""].map(celda).join(","));
  return ["Tipo,Nombre,DNI,Estado,Email,Teléfono", ...filas].join("\n");
}

