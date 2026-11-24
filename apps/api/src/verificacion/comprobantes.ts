/**
 * Comprobantes de transferencia: foto → IA → cruce con la cuenta de Mercado Pago → confirmado o "Revisar".
 *
 * Etapa 6 (decisión del dueño, 23/11/2026): el motor y la bandeja quedan listos, pero todavía no se
 * conectan a ningún cobro. Fiestas (etapa 7) y cuotas (etapa 9) llaman a registrarComprobante y pasan
 * `alConfirmar`, que corre dentro de la misma transacción para registrar el pago.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { formatearPesos, MONTO_MAXIMO_CENTAVOS } from "@3t/shared";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Transaccion } from "../db/cliente.js";
import { archivos, comprobantes, entradasMercadoPago } from "../db/esquema.js";
import { ErrorNegocio, noExiste } from "../errores.js";
import { fechaDeLectura, type LecturaComprobante, type LectorComprobantes } from "../ia/lectorComprobantes.js";
import { TAMANO_MAXIMO_IMAGEN, tipoDeImagen } from "../tickets/tickets.js";
import { DIAS_DE_TOLERANCIA, decidir, type CodigoRevision, type DatosComprobante, type Decision, type EntradaCuenta } from "./cruce.js";

export interface DependenciasVerificacion {
  lector: LectorComprobantes;
  /** Entradas aprobadas a la cuenta entre dos fechas. null si no hay clave de Mercado Pago cargada. */
  buscarEntradas: ((desde: Date, hasta: Date) => Promise<EntradaCuenta[]>) | null;
  /** Para los tests: la hora actual. */
  ahora?: () => Date;
}

type Comprobante = typeof comprobantes.$inferSelect;
/** Lo que hace el cobro (fiesta, cuota) cuando su comprobante queda confirmado. Corre en la misma transacción. */
export type AlConfirmar = (tx: Transaccion, comprobante: Comprobante, entrada: EntradaCuenta) => Promise<void>;

export type CodigoRevisionComprobante = CodigoRevision | "REPETIDA" | "NO_ES_COMPROBANTE" | "SIN_CUENTA";

type Evaluacion =
  | { resultado: "CONFIRMAR"; entrada: EntradaCuenta; por: "NUMERO_OPERACION" | "CUIT" }
  | { resultado: "REVISAR"; codigo: CodigoRevisionComprobante; motivo: string; candidatos: EntradaCuenta[] };

const DIA_MS = 24 * 3600_000;

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function prepararImagen(contenido: Buffer) {
  if (contenido.length === 0) throw new ErrorNegocio(400, "IMAGEN_VACIA", "La foto está vacía.");
  if (contenido.length > TAMANO_MAXIMO_IMAGEN) throw new ErrorNegocio(400, "IMAGEN_GRANDE", "La foto es demasiado grande (máximo 4 MB).");
  const tipoMime = tipoDeImagen(contenido);
  if (!tipoMime) throw new ErrorNegocio(400, "NO_ES_IMAGEN", "El archivo no es una foto (JPG, PNG o WEBP).");
  return { tipoMime, sha256: createHash("sha256").update(contenido).digest("hex") };
}

/** Pasa lo leído por la IA a lo que necesita la regla. Si la lectura no sirve, devuelve el motivo. */
export function datosDeLectura(lectura: LecturaComprobante): { ok: true; datos: DatosComprobante } | { ok: false; codigo: CodigoRevisionComprobante; motivo: string } {
  if (!lectura.es_comprobante) return { ok: false, codigo: "NO_ES_COMPROBANTE", motivo: "La IA dice que la foto no parece un comprobante de transferencia." };
  if (!lectura.legible || lectura.monto_centavos === null) {
    return { ok: false, codigo: "ILEGIBLE", motivo: `La IA no pudo leerlo con seguridad.${lectura.observaciones ? ` ${lectura.observaciones}` : ""}` };
  }
  const monto = BigInt(lectura.monto_centavos);
  if (monto <= 0n || monto > MONTO_MAXIMO_CENTAVOS) return { ok: false, codigo: "ILEGIBLE", motivo: "El monto leído no es válido." };
  return {
    ok: true,
    datos: { montoCentavos: monto, fecha: fechaDeLectura(lectura.fecha_hora), cuitPagador: lectura.cuit_pagador, numeroOperacion: lectura.numero_operacion },
  };
}

/** Desde cuándo y hasta cuándo buscar en la cuenta. */
function ventana(fecha: Date | null, ahora: Date): [Date, Date] {
  if (!fecha) return [new Date(ahora.getTime() - 30 * DIA_MS), ahora];
  const desde = new Date(fecha.getTime() - DIAS_DE_TOLERANCIA * DIA_MS);
  const hasta = new Date(Math.min(fecha.getTime() + DIAS_DE_TOLERANCIA * DIA_MS, ahora.getTime()));
  return [desde, hasta < desde ? ahora : hasta];
}

/** Lo que ya se usó, entre las entradas encontradas. */
async function yaUsadas(db: BaseDeDatos | Transaccion, entradas: EntradaCuenta[]): Promise<Set<string>> {
  if (entradas.length === 0) return new Set();
  const filas = await db
    .select({ id: entradasMercadoPago.mpPagoId })
    .from(entradasMercadoPago)
    .where(inArray(entradasMercadoPago.mpPagoId, entradas.map((e) => e.mpPagoId)));
  return new Set(filas.map((f) => f.id));
}

/** Busca en la cuenta y aplica la regla. No guarda nada. */
async function evaluarContraCuenta(
  db: BaseDeDatos,
  deps: DependenciasVerificacion,
  datos: DatosComprobante,
  montoEsperado: bigint | null,
): Promise<Evaluacion> {
  if (!deps.buscarEntradas) {
    return { resultado: "REVISAR", codigo: "SIN_CUENTA", motivo: "La app todavía no está conectada a Mercado Pago.", candidatos: [] };
  }
  const ahora = deps.ahora?.() ?? new Date();
  let entradas: EntradaCuenta[];
  try {
    entradas = await deps.buscarEntradas(...ventana(datos.fecha, ahora));
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return { resultado: "REVISAR", codigo: "SIN_CUENTA", motivo: `No se pudo consultar Mercado Pago: ${detalle}`, candidatos: [] };
  }
  return decidir(datos, entradas, await yaUsadas(db, entradas), montoEsperado);
}

const candidatosParaGuardar = (candidatos: EntradaCuenta[]) =>
  candidatos.slice(0, 10).map((c) => ({ mpPagoId: c.mpPagoId, montoCentavos: c.montoCentavos.toString(), fecha: c.fecha.toISOString() }));

/** Guarda la entrada como usada. Devuelve false si otro pago la usó justo antes. */
async function marcarUsada(tx: Transaccion, entrada: EntradaCuenta): Promise<boolean> {
  const filas = await tx
    .insert(entradasMercadoPago)
    .values({ mpPagoId: entrada.mpPagoId, e2eId: entrada.e2eId, montoCentavos: entrada.montoCentavos, fecha: entrada.fecha, cuitPagador: entrada.cuitPagador })
    .onConflictDoNothing()
    .returning({ id: entradasMercadoPago.mpPagoId });
  return filas.length === 1;
}

/** Aplica una evaluación a un comprobante (nuevo o en revisión) dentro de una transacción. */
async function aplicar(
  tx: Transaccion,
  actor: Actor,
  comprobante: Comprobante,
  evaluacion: Evaluacion,
  alConfirmar: AlConfirmar | undefined,
): Promise<Comprobante> {
  if (evaluacion.resultado === "CONFIRMAR") {
    if (await marcarUsada(tx, evaluacion.entrada)) {
      const [actualizado] = await tx
        .update(comprobantes)
        .set({
          estado: "VERIFICADO_AUTO",
          mpPagoId: evaluacion.entrada.mpPagoId,
          confirmadoPor: evaluacion.por,
          codigoRevision: null,
          motivoRevision: null,
          candidatos: null,
        })
        .where(eq(comprobantes.id, comprobante.id))
        .returning();
      if (!actualizado) throw new Error("No se pudo confirmar el comprobante");
      await alConfirmar?.(tx, actualizado, evaluacion.entrada);
      await registrarAuditoria(tx, actor, {
        accion: "COMPROBANTE_VERIFICADO_AUTO",
        entidad: "comprobantes",
        entidadId: actualizado.id,
        despues: { mpPagoId: evaluacion.entrada.mpPagoId, por: evaluacion.por, montoCentavos: evaluacion.entrada.montoCentavos.toString() },
      });
      return actualizado;
    }
    evaluacion = { resultado: "REVISAR", codigo: "YA_USADO", motivo: "Esa transferencia se acaba de usar para otro pago.", candidatos: [evaluacion.entrada] };
  }
  const [actualizado] = await tx
    .update(comprobantes)
    .set({ estado: "REVISAR", codigoRevision: evaluacion.codigo, motivoRevision: evaluacion.motivo, candidatos: candidatosParaGuardar(evaluacion.candidatos) })
    .where(eq(comprobantes.id, comprobante.id))
    .returning();
  if (!actualizado) throw new Error("No se pudo actualizar el comprobante");
  return actualizado;
}

// ---------------------------------------------------------------------------
// Lo que usan los cobros y la bandeja "Revisar"
// ---------------------------------------------------------------------------

export async function registrarComprobante(
  db: BaseDeDatos,
  deps: DependenciasVerificacion,
  actor: Actor,
  datos: {
    contenido: Buffer;
    destino: "CUOTA" | "ENTRADA_FIESTA";
    referenciaId?: string;
    montoEsperadoCentavos?: bigint;
    subidoPor?: string;
  },
  alConfirmar?: AlConfirmar,
): Promise<Comprobante> {
  const { tipoMime, sha256 } = prepararImagen(datos.contenido);
  const montoEsperado = datos.montoEsperadoCentavos ?? null;
  if (montoEsperado !== null && montoEsperado <= 0n) throw new ErrorNegocio(400, "MONTO_INVALIDO", "El monto esperado no es válido.");

  const [repetida] = await db
    .select({ id: comprobantes.id })
    .from(comprobantes)
    .innerJoin(archivos, eq(archivos.id, comprobantes.archivoId))
    .where(and(eq(archivos.sha256, sha256), ne(comprobantes.estado, "RECHAZADO")))
    .limit(1);

  // La IA y Mercado Pago se consultan fuera de la transacción: pueden tardar y no tienen que trabar la base.
  let lectura: LecturaComprobante | null = null;
  let evaluacion: Evaluacion;
  if (repetida) {
    evaluacion = { resultado: "REVISAR", codigo: "REPETIDA", motivo: "Este mismo comprobante ya se había subido.", candidatos: [] };
  } else {
    try {
      lectura = await deps.lector({ contenido: datos.contenido, tipoMime });
      const leidos = datosDeLectura(lectura);
      evaluacion = leidos.ok
        ? await evaluarContraCuenta(db, deps, leidos.datos, montoEsperado)
        : { resultado: "REVISAR", codigo: leidos.codigo, motivo: leidos.motivo, candidatos: [] };
    } catch (error) {
      evaluacion = { resultado: "REVISAR", codigo: "ILEGIBLE", motivo: error instanceof Error ? error.message : "La IA no pudo leer el comprobante.", candidatos: [] };
    }
  }

  return db.transaction(async (tx) => {
    const [archivo] = await tx
      .insert(archivos)
      .values({ tipoMime, tamanoBytes: datos.contenido.length, sha256, contenido: datos.contenido })
      .returning({ id: archivos.id });
    if (!archivo) throw new Error("No se pudo guardar la foto");
    const [nuevo] = await tx
      .insert(comprobantes)
      .values({
        destino: datos.destino,
        referenciaId: datos.referenciaId ?? null,
        montoEsperadoCentavos: montoEsperado,
        archivoId: archivo.id,
        estado: "REVISAR",
        lecturaIa: lectura,
        subidoPor: datos.subidoPor ?? null,
      })
      .returning();
    if (!nuevo) throw new Error("No se pudo guardar el comprobante");
    await registrarAuditoria(tx, actor, { accion: "COMPROBANTE_SUBIDO", entidad: "comprobantes", entidadId: nuevo.id });
    return aplicar(tx, actor, nuevo, evaluacion, alConfirmar);
  });
}

async function buscarComprobante(db: BaseDeDatos | Transaccion, id: string): Promise<Comprobante> {
  const [c] = await db.select().from(comprobantes).where(eq(comprobantes.id, id)).limit(1);
  if (!c) throw noExiste("El comprobante");
  return c;
}

function enRevision(c: Comprobante) {
  if (c.estado !== "REVISAR") throw new ErrorNegocio(409, "YA_RESUELTO", "Ese comprobante ya está resuelto.");
}

/** Vuelve a buscar en la cuenta (por ejemplo, si la transferencia todavía no figuraba). */
export async function verificarDeNuevo(
  db: BaseDeDatos,
  deps: DependenciasVerificacion,
  actor: ActorAdmin,
  id: string,
  alConfirmar?: AlConfirmar,
): Promise<Comprobante> {
  const comprobante = await buscarComprobante(db, id);
  enRevision(comprobante);
  if (comprobante.codigoRevision === "REPETIDA") {
    throw new ErrorNegocio(409, "REPETIDA", "Es una foto repetida: confirmala a mano o rechazala.");
  }
  let lectura = comprobante.lecturaIa as LecturaComprobante | null;
  if (!lectura) {
    const [archivo] = await db.select().from(archivos).where(eq(archivos.id, comprobante.archivoId)).limit(1);
    if (!archivo) throw noExiste("La foto");
    try {
      lectura = await deps.lector({ contenido: archivo.contenido, tipoMime: archivo.tipoMime });
    } catch (error) {
      throw new ErrorNegocio(422, "IA_NO_RESPONDE", error instanceof Error ? error.message : "La IA no pudo leer el comprobante.");
    }
  }
  const leidos = datosDeLectura(lectura);
  const evaluacion: Evaluacion = leidos.ok
    ? await evaluarContraCuenta(db, deps, leidos.datos, comprobante.montoEsperadoCentavos)
    : { resultado: "REVISAR", codigo: leidos.codigo, motivo: leidos.motivo, candidatos: [] };
  return db.transaction(async (tx) => aplicar(tx, actor, await buscarComprobante(tx, id), evaluacion, alConfirmar));
}

/** Un admin confirma a mano, eligiendo la entrada de la cuenta que corresponde (que sigue sin usar). */
export async function confirmarAMano(
  db: BaseDeDatos,
  deps: DependenciasVerificacion,
  actor: ActorAdmin,
  id: string,
  mpPagoId: string,
  alConfirmar?: AlConfirmar,
): Promise<Comprobante> {
  const comprobante = await buscarComprobante(db, id);
  enRevision(comprobante);
  if (!deps.buscarEntradas) throw new ErrorNegocio(409, "SIN_CUENTA", "La app todavía no está conectada a Mercado Pago.");

  const lectura = comprobante.lecturaIa as LecturaComprobante | null;
  const ahora = deps.ahora?.() ?? new Date();
  const fecha = lectura ? fechaDeLectura(lectura.fecha_hora) : null;
  const [desde, hasta] = fecha ? [new Date(fecha.getTime() - 15 * DIA_MS), ahora] : [new Date(ahora.getTime() - 60 * DIA_MS), ahora];
  const entrada = (await deps.buscarEntradas(desde, hasta)).find((e) => e.mpPagoId === mpPagoId);
  if (!entrada) throw new ErrorNegocio(404, "NO_FIGURA", "Esa transferencia no figura como entrada aprobada en la cuenta.");
  if (comprobante.montoEsperadoCentavos !== null && entrada.montoCentavos !== comprobante.montoEsperadoCentavos) {
    throw new ErrorNegocio(
      409,
      "MONTO_DISTINTO",
      `Esa transferencia es por ${formatearPesos(entrada.montoCentavos)} y había que pagar ${formatearPesos(comprobante.montoEsperadoCentavos)}.`,
    );
  }

  return db.transaction(async (tx) => {
    const actual = await buscarComprobante(tx, id);
    enRevision(actual);
    if (!(await marcarUsada(tx, entrada))) throw new ErrorNegocio(409, "YA_USADO", "Esa transferencia ya se usó para otro pago.");
    const [actualizado] = await tx
      .update(comprobantes)
      .set({ estado: "CONFIRMADO", mpPagoId: entrada.mpPagoId, confirmadoPor: "ADMIN", resueltoPorAdminId: actor.adminId })
      .where(eq(comprobantes.id, id))
      .returning();
    if (!actualizado) throw new Error("No se pudo confirmar el comprobante");
    await alConfirmar?.(tx, actualizado, entrada);
    await registrarAuditoria(tx, actor, {
      accion: "COMPROBANTE_CONFIRMADO_A_MANO",
      entidad: "comprobantes",
      entidadId: id,
      antes: { codigoRevision: actual.codigoRevision, motivoRevision: actual.motivoRevision },
      despues: { mpPagoId: entrada.mpPagoId, montoCentavos: entrada.montoCentavos.toString() },
    });
    return actualizado;
  });
}

export async function rechazarComprobante(db: BaseDeDatos, actor: ActorAdmin, id: string, motivo: string): Promise<Comprobante> {
  const limpio = motivo.trim();
  if (limpio.length < 3) throw new ErrorNegocio(400, "FALTA_MOTIVO", "Escribí por qué se rechaza.");
  return db.transaction(async (tx) => {
    const actual = await buscarComprobante(tx, id);
    enRevision(actual);
    const [actualizado] = await tx
      .update(comprobantes)
      .set({ estado: "RECHAZADO", motivoRechazo: limpio.slice(0, 300), resueltoPorAdminId: actor.adminId })
      .where(eq(comprobantes.id, id))
      .returning();
    if (!actualizado) throw new Error("No se pudo rechazar el comprobante");
    await registrarAuditoria(tx, actor, { accion: "COMPROBANTE_RECHAZADO", entidad: "comprobantes", entidadId: id, despues: { motivo: limpio } });
    return actualizado;
  });
}

export async function comprobantesParaRevisar(db: BaseDeDatos) {
  const filas = await db.select().from(comprobantes).where(eq(comprobantes.estado, "REVISAR")).orderBy(desc(comprobantes.creadoEn)).limit(200);
  return filas.map((c) => {
    const l = c.lecturaIa as LecturaComprobante | null;
    return {
      id: c.id,
      destino: c.destino,
      referenciaId: c.referenciaId,
      creadoEn: c.creadoEn.toISOString(),
      subidoPor: c.subidoPor,
      montoEsperadoCentavos: c.montoEsperadoCentavos,
      codigo: c.codigoRevision,
      motivo: c.motivoRevision,
      candidatos: (c.candidatos ?? []) as { mpPagoId: string; montoCentavos: string; fecha: string }[],
      leido: l
        ? {
            montoCentavos: l.monto_centavos === null ? null : String(l.monto_centavos),
            fechaHora: l.fecha_hora,
            nombrePagador: l.nombre_pagador,
            cuitPagador: l.cuit_pagador,
            bancoOrigen: l.banco_origen,
            numeroOperacion: l.numero_operacion,
          }
        : null,
    };
  });
}

export async function fotoDeComprobante(db: BaseDeDatos, id: string) {
  const [fila] = await db
    .select({ tipoMime: archivos.tipoMime, contenido: archivos.contenido })
    .from(comprobantes)
    .innerJoin(archivos, eq(archivos.id, comprobantes.archivoId))
    .where(eq(comprobantes.id, id))
    .limit(1);
  if (!fila) throw noExiste("El comprobante");
  return fila;
}

/**
 * Prueba para el dueño: lee un comprobante y dice qué haría la app, SIN guardar nada.
 * Sirve para probar con transferencias reales antes de usarlo en cuotas y fiestas.
 */
export async function probarComprobante(db: BaseDeDatos, deps: DependenciasVerificacion, contenido: Buffer) {
  const { tipoMime } = prepararImagen(contenido);
  let lectura: LecturaComprobante;
  try {
    lectura = await deps.lector({ contenido, tipoMime });
  } catch (error) {
    throw new ErrorNegocio(422, "IA_NO_RESPONDE", error instanceof Error ? error.message : "La IA no pudo leer el comprobante.");
  }
  const leidos = datosDeLectura(lectura);
  const evaluacion: Evaluacion = leidos.ok
    ? await evaluarContraCuenta(db, deps, leidos.datos, null)
    : { resultado: "REVISAR", codigo: leidos.codigo, motivo: leidos.motivo, candidatos: [] };
  const resumen: Decision | Evaluacion = evaluacion;
  return {
    lectura,
    resultado: resumen.resultado,
    ...(resumen.resultado === "CONFIRMAR"
      ? { por: resumen.por, mpPagoId: resumen.entrada.mpPagoId, montoCentavos: resumen.entrada.montoCentavos }
      : { codigo: resumen.codigo, motivo: resumen.motivo, candidatos: candidatosParaGuardar(resumen.candidatos) }),
  };
}
