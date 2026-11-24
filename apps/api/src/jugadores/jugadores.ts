/**
 * Jugadores del plantel (etapa 7).
 *
 * - Los admins dan de alta y corrigen datos de contacto. El DNI lo cambia solo el dueño, porque es lo que
 *   usa la verificación automática de transferencias.
 * - Solo el dueño da de baja, reactiva, elimina e importa la lista del Formulario de Google.
 * - Eliminar: si el jugador no tiene nada asociado se borra por completo; si tiene pagos, se borran sus
 *   datos personales y queda como "Jugador eliminado".
 * - La auditoría registra qué campos cambiaron, pero NO guarda datos personales (nombre, DNI, teléfono,
 *   email): si no, quedarían para siempre aunque el jugador se elimine.
 */
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { normalizarDni } from "@3t/shared";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { BaseDeDatos, Ejecutor } from "../db/cliente.js";
import { jugadores } from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { leerCsv } from "./csv.js";
import { anularPendientesDeJugadorEliminado } from "../cuotas/cuotas.js";

type Jugador = typeof jugadores.$inferSelect;

// ---------------------------------------------------------------------------
// Validación de datos
// ---------------------------------------------------------------------------

const textoNombre = (que: string) =>
  z
    .string({ required_error: `Falta el ${que}.` })
    .trim()
    .min(1, `Falta el ${que}.`)
    .max(60, `El ${que} es demasiado largo.`)
    .transform((t) => t.replace(/\s+/g, " "));

export const dniSchema = z
  .string({ required_error: "Falta el DNI." })
  .transform((t, ctx) => {
    const dni = normalizarDni(t);
    if (!dni) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El DNI no es válido (tienen que ser 7 u 8 números)." });
      return z.NEVER;
    }
    return dni;
  });

const telefonoSchema = z
  .string()
  .trim()
  .max(30)
  .transform((t, ctx) => {
    if (t === "") return null;
    const digitos = t.replace(/\D/g, "");
    if (digitos.length < 8 || digitos.length > 15) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El teléfono no es válido." });
      return z.NEVER;
    }
    return digitos;
  });

const emailSchema = z
  .string()
  .trim()
  .max(120)
  .transform((t, ctx) => {
    if (t === "") return null;
    if (!z.string().email().safeParse(t).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El email no es válido." });
      return z.NEVER;
    }
    return t.toLowerCase();
  });

const camadaSchema = z
  .string()
  .trim()
  .max(20, "La camada es demasiado larga.")
  .transform((t) => (t === "" ? null : t));

export const datosJugadorSchema = z.object({
  nombre: textoNombre("nombre"),
  apellido: textoNombre("apellido"),
  dni: dniSchema,
  telefono: telefonoSchema.optional(),
  email: emailSchema.optional(),
  camada: camadaSchema.optional(),
});
export type DatosJugador = z.infer<typeof datosJugadorSchema>;

export const cambiosJugadorSchema = datosJugadorSchema.partial();
export type CambiosJugador = z.infer<typeof cambiosJugadorSchema>;

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function jugadorParaMostrar(j: Jugador) {
  return {
    id: j.id,
    nombre: j.nombre,
    apellido: j.apellido,
    dni: j.dni,
    telefono: j.telefono,
    email: j.email,
    camada: j.camada,
    estado: j.estado,
    altaEn: j.creadoEn.toISOString(),
    bajaEn: j.bajaEn?.toISOString() ?? null,
  };
}

async function buscar(db: Ejecutor, id: string): Promise<Jugador> {
  const [j] = await db.select().from(jugadores).where(eq(jugadores.id, id)).limit(1);
  if (!j) throw noExiste("El jugador");
  return j;
}

async function dniLibre(db: Ejecutor, dni: string, salvo?: string) {
  const [otro] = await db.select().from(jugadores).where(eq(jugadores.dni, dni)).limit(1);
  if (otro && otro.id !== salvo) {
    throw new ErrorNegocio(409, "DNI_REPETIDO", `Ya hay un jugador con ese DNI: ${otro.nombre} ${otro.apellido}.`);
  }
}

export async function listarJugadores(db: BaseDeDatos, filtro: { estado?: "ACTIVO" | "BAJA" | "TODOS" | undefined; buscar?: string | undefined } = {}) {
  const condiciones = [];
  const estado = filtro.estado ?? "ACTIVO";
  if (estado === "TODOS") condiciones.push(inArray(jugadores.estado, ["ACTIVO", "BAJA"]));
  else condiciones.push(eq(jugadores.estado, estado));
  const texto = filtro.buscar?.trim();
  if (texto) {
    // Sin tildes de ningún lado: "gomez" encuentra a "Gómez".
    const patron = `%${sinTildes(texto).replace(/[%_\\]/g, "\\$&")}%`;
    const plano = (columna: SQL) => sql`lower(translate(${columna}, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))`;
    const soloNumeros = texto.replace(/\D/g, "");
    condiciones.push(
      or(
        ilike(plano(sql`${jugadores.nombre} || ' ' || ${jugadores.apellido}`), patron),
        ilike(plano(sql`${jugadores.apellido} || ' ' || ${jugadores.nombre}`), patron),
        ilike(plano(sql`coalesce(${jugadores.camada}, '')`), patron),
        ...(soloNumeros.length >= 3 ? [ilike(jugadores.dni, `%${soloNumeros}%`)] : []),
      ),
    );
  }
  const filas = await db
    .select()
    .from(jugadores)
    .where(and(...condiciones))
    .orderBy(asc(jugadores.apellido), asc(jugadores.nombre))
    .limit(500);
  const [cuenta] = await db
    .select({ activos: sql<number>`count(*) filter (where ${jugadores.estado} = 'ACTIVO')`.mapWith(Number), baja: sql<number>`count(*) filter (where ${jugadores.estado} = 'BAJA')`.mapWith(Number) })
    .from(jugadores);
  return { jugadores: filas.map(jugadorParaMostrar), totales: cuenta ?? { activos: 0, baja: 0 } };
}

/** El jugador ACTIVO con ese DNI (lo usa la verificación automática de transferencias). */
export async function jugadorActivoPorDni(db: Ejecutor, dni: string): Promise<Jugador | null> {
  const [j] = await db
    .select()
    .from(jugadores)
    .where(and(eq(jugadores.dni, dni), eq(jugadores.estado, "ACTIVO")))
    .limit(1);
  return j ?? null;
}

// ---------------------------------------------------------------------------
// Cambios
// ---------------------------------------------------------------------------

/** Qué campos cambiaron, sin los valores (para la auditoría). */
const camposCambiados = (antes: Partial<Jugador>, despues: Partial<Jugador>) =>
  (["nombre", "apellido", "dni", "telefono", "email", "camada", "estado"] as const).filter((c) => c in despues && antes[c] !== despues[c]);

export async function crearJugador(db: BaseDeDatos, actor: ActorAdmin, datos: DatosJugador) {
  return db.transaction(async (tx) => {
    await dniLibre(tx, datos.dni);
    const [nuevo] = await tx
      .insert(jugadores)
      .values({
        nombre: datos.nombre,
        apellido: datos.apellido,
        dni: datos.dni,
        telefono: datos.telefono ?? null,
        email: datos.email ?? null,
        camada: datos.camada ?? null,
      })
      .returning();
    if (!nuevo) throw new Error("No se pudo guardar el jugador");
    await registrarAuditoria(tx, actor, { accion: "JUGADOR_ALTA", entidad: "jugadores", entidadId: nuevo.id });
    return jugadorParaMostrar(nuevo);
  });
}

export async function editarJugador(db: BaseDeDatos, actor: ActorAdmin, id: string, cambios: CambiosJugador) {
  return db.transaction(async (tx) => {
    const actual = await buscar(tx, id);
    if (actual.estado === "ELIMINADO") throw new ErrorNegocio(409, "ELIMINADO", "Este jugador fue eliminado.");
    if (cambios.dni !== undefined && cambios.dni !== actual.dni) {
      if (actor.rol !== "DUENO") throw soloDueno("cambiar el DNI (es lo que usa la app para reconocer sus transferencias)");
      await dniLibre(tx, cambios.dni, id);
    }
    const valores: Partial<Jugador> = {};
    if (cambios.nombre !== undefined) valores.nombre = cambios.nombre;
    if (cambios.apellido !== undefined) valores.apellido = cambios.apellido;
    if (cambios.dni !== undefined) valores.dni = cambios.dni;
    if (cambios.telefono !== undefined) valores.telefono = cambios.telefono;
    if (cambios.email !== undefined) valores.email = cambios.email;
    if (cambios.camada !== undefined) valores.camada = cambios.camada;
    const campos = camposCambiados(actual, valores);
    if (campos.length === 0) return jugadorParaMostrar(actual);
    const [actualizado] = await tx.update(jugadores).set(valores).where(eq(jugadores.id, id)).returning();
    if (!actualizado) throw new Error("No se pudo actualizar el jugador");
    await registrarAuditoria(tx, actor, { accion: "JUGADOR_EDITADO", entidad: "jugadores", entidadId: id, despues: { campos } });
    return jugadorParaMostrar(actualizado);
  });
}

export async function darDeBaja(db: BaseDeDatos, actor: ActorAdmin, id: string) {
  if (actor.rol !== "DUENO") throw soloDueno("dar de baja jugadores");
  return db.transaction(async (tx) => {
    const actual = await buscar(tx, id);
    if (actual.estado !== "ACTIVO") throw new ErrorNegocio(409, "NO_ACTIVO", "Ese jugador no está activo.");
    const [j] = await tx.update(jugadores).set({ estado: "BAJA", bajaEn: new Date() }).where(eq(jugadores.id, id)).returning();
    if (!j) throw new Error("No se pudo dar de baja");
    await registrarAuditoria(tx, actor, { accion: "JUGADOR_BAJA", entidad: "jugadores", entidadId: id });
    return jugadorParaMostrar(j);
  });
}

export async function reactivar(db: BaseDeDatos, actor: ActorAdmin, id: string) {
  if (actor.rol !== "DUENO") throw soloDueno("reactivar jugadores");
  return db.transaction(async (tx) => {
    const actual = await buscar(tx, id);
    if (actual.estado !== "BAJA") throw new ErrorNegocio(409, "NO_ESTA_DE_BAJA", "Ese jugador no está dado de baja.");
    const [j] = await tx.update(jugadores).set({ estado: "ACTIVO", bajaEn: null }).where(eq(jugadores.id, id)).returning();
    if (!j) throw new Error("No se pudo reactivar");
    await registrarAuditoria(tx, actor, { accion: "JUGADOR_REACTIVADO", entidad: "jugadores", entidadId: id });
    return jugadorParaMostrar(j);
  });
}


/**
 * Elimina un jugador. Hay que escribir su nombre completo para confirmar.
 * Si tiene algo asociado (pagos, cuotas), la base no deja borrarlo: se borran sus datos personales.
 */
export async function eliminarJugador(db: BaseDeDatos, actor: ActorAdmin, id: string, confirmacion: string) {
  if (actor.rol !== "DUENO") throw soloDueno("eliminar jugadores");
  return db.transaction(async (tx) => {
    const actual = await buscar(tx, id);
    if (actual.estado === "ELIMINADO") throw new ErrorNegocio(409, "ELIMINADO", "Este jugador ya fue eliminado.");
    if (sinTildes(confirmacion) !== sinTildes(`${actual.nombre} ${actual.apellido}`)) {
      throw new ErrorNegocio(400, "CONFIRMACION_INCORRECTA", "Para confirmar, escribí el nombre y apellido del jugador tal como figura.");
    }
    let borrado = true;
    try {
      // Punto de guardado: si la base no lo deja borrar (tiene pagos), se sigue con la anonimización.
      await tx.transaction(async (sp) => {
        await sp.delete(jugadores).where(eq(jugadores.id, id));
      });
    } catch (error) {
      const codigo = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (codigo !== "23503") throw error;
      borrado = false;
    }
    if (!borrado) {
      await anularPendientesDeJugadorEliminado(tx, id);
      await tx
        .update(jugadores)
        .set({ estado: "ELIMINADO", nombre: null, apellido: null, dni: null, telefono: null, email: null, bajaEn: null, eliminadoEn: new Date() })
        .where(eq(jugadores.id, id));
    }
    await registrarAuditoria(tx, actor, {
      accion: borrado ? "JUGADOR_BORRADO" : "JUGADOR_ANONIMIZADO",
      entidad: "jugadores",
      entidadId: id,
    });
    return { borrado, anonimizado: !borrado };
  });
}

// ---------------------------------------------------------------------------
// Importación desde el Formulario de Google (CSV)
// ---------------------------------------------------------------------------

export const TAMANO_MAXIMO_CSV = 1024 * 1024;
const FILAS_MAXIMAS = 1000;

type Columna = "nombre" | "apellido" | "dni" | "telefono" | "email" | "camada";

/** Reconoce cada columna por su título (como lo pone el formulario). */
function reconocerColumna(titulo: string): Columna | null {
  const t = sinTildes(titulo);
  if (/apellido/.test(t) && /nombre/.test(t)) return null; // "Nombre y apellido" juntos: no se puede separar bien
  if (/apellido/.test(t)) return "apellido";
  if (/nombre/.test(t)) return "nombre";
  if (/\bdni\b|documento/.test(t)) return "dni";
  if (/tel|celular|whats|movil/.test(t)) return "telefono";
  if (/mail|correo/.test(t)) return "email";
  if (/camada|categoria|ano de nacimiento|division/.test(t)) return "camada";
  return null;
}

export interface FilaImportacion {
  fila: number;
  nombre: string;
  apellido: string;
  dni: string;
  camada: string;
  estado: "NUEVO" | "YA_ESTA" | "ERROR";
  motivo: string | null;
  datos: DatosJugador | null;
}

export async function analizarImportacion(db: BaseDeDatos, csv: string) {
  if (csv.length > TAMANO_MAXIMO_CSV) throw new ErrorNegocio(400, "ARCHIVO_GRANDE", "El archivo es demasiado grande.");
  const filas = leerCsv(csv);
  const [encabezado, ...resto] = filas;
  if (!encabezado || resto.length === 0) throw new ErrorNegocio(400, "ARCHIVO_VACIO", "El archivo no tiene respuestas.");
  if (resto.length > FILAS_MAXIMAS) throw new ErrorNegocio(400, "DEMASIADAS_FILAS", `El archivo tiene más de ${FILAS_MAXIMAS} filas.`);

  const columnas = new Map<Columna, number>();
  encabezado.forEach((titulo, i) => {
    const c = reconocerColumna(titulo);
    if (c && !columnas.has(c)) columnas.set(c, i);
  });
  const faltan = (["nombre", "apellido", "dni"] as const).filter((c) => !columnas.has(c));
  if (faltan.length > 0) {
    throw new ErrorNegocio(
      400,
      "FALTAN_COLUMNAS",
      `No encontré la columna de ${faltan.join(", ")}. El formulario tiene que tener preguntas separadas para Nombre, Apellido y DNI.`,
    );
  }

  const valor = (fila: string[], c: Columna) => {
    const i = columnas.get(c);
    return i === undefined ? "" : (fila[i] ?? "").trim();
  };
  const existentes = await db.select({ dni: jugadores.dni, nombre: jugadores.nombre, apellido: jugadores.apellido }).from(jugadores);
  const porDni = new Map(existentes.filter((e) => e.dni).map((e) => [e.dni as string, `${e.nombre} ${e.apellido}`]));
  const vistosEnArchivo = new Map<string, number>();

  const resultado: FilaImportacion[] = resto.map((fila, i) => {
    const numero = i + 2; // la fila 1 es el encabezado
    const crudo = { nombre: valor(fila, "nombre"), apellido: valor(fila, "apellido"), dni: valor(fila, "dni"), camada: valor(fila, "camada") };
    const datos = datosJugadorSchema.safeParse({ ...crudo, telefono: valor(fila, "telefono"), email: valor(fila, "email") });
    if (!datos.success) {
      return { fila: numero, ...crudo, estado: "ERROR", motivo: datos.error.issues.map((x) => x.message).join(" "), datos: null };
    }
    const dni = datos.data.dni;
    const yaEsta = porDni.get(dni);
    if (yaEsta) return { fila: numero, ...crudo, estado: "YA_ESTA", motivo: `Ya está cargado (${yaEsta}).`, datos: null };
    const filaAnterior = vistosEnArchivo.get(dni);
    if (filaAnterior) return { fila: numero, ...crudo, estado: "ERROR", motivo: `El DNI está repetido (también en la fila ${filaAnterior}).`, datos: null };
    vistosEnArchivo.set(dni, numero);
    return { fila: numero, ...crudo, estado: "NUEVO", motivo: null, datos: datos.data };
  });

  return {
    filas: resultado,
    resumen: {
      nuevos: resultado.filter((f) => f.estado === "NUEVO").length,
      yaEstan: resultado.filter((f) => f.estado === "YA_ESTA").length,
      conError: resultado.filter((f) => f.estado === "ERROR").length,
    },
    columnasReconocidas: [...columnas.keys()],
  };
}

/** Da de alta a todos los NUEVOS del archivo, juntos (o ninguno si algo falla). Solo el dueño. */
export async function importarJugadores(db: BaseDeDatos, actor: ActorAdmin, csv: string) {
  if (actor.rol !== "DUENO") throw soloDueno("importar la lista de jugadores");
  const analisis = await analizarImportacion(db, csv);
  const nuevos = analisis.filas.flatMap((f) => (f.estado === "NUEVO" && f.datos ? [f.datos] : []));
  if (nuevos.length === 0) return { ...analisis.resumen, importados: 0 };
  await db.transaction(async (tx) => {
    const insertados = await tx
      .insert(jugadores)
      .values(nuevos.map((d) => ({ nombre: d.nombre, apellido: d.apellido, dni: d.dni, telefono: d.telefono ?? null, email: d.email ?? null, camada: d.camada ?? null })))
      .returning({ id: jugadores.id });
    await registrarAuditoria(tx, actor, {
      accion: "JUGADORES_IMPORTADOS",
      entidad: "jugadores",
      entidadId: "importacion",
      despues: { cantidad: insertados.length, ids: insertados.map((i) => i.id) },
    });
  });
  return { ...analisis.resumen, importados: nuevos.length };
}
