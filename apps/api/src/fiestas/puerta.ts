/**
 * Puerta de la fiesta (etapa 9.3).
 *
 * - Cada fiesta tiene un link de puerta secreto. Cualquiera que lo tenga (un jugador, desde el navegador del celular)
 *   puede escanear los QR. Quién marcó cada entrada se guarda con el nombre que escribió al abrir el link.
 * - El celular descarga la lista para seguir andando sin señal. De cada entrada baja el nombre, el DNI y el tipo,
 *   y una "huella" del código del QR (no el código en sí), así la lista no sirve para fabricar entradas.
 * - Cada entrada entra una sola vez. Si dos celulares la marcan a la vez, gana el primero y el otro ve "ya entró".
 * - Cada ingreso trae un identificador del celular: si se reintenta (por mala señal), no se cuenta dos veces.
 */
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import type { BaseDeDatos } from "../db/cliente.js";
import { entradas, fiestas, tiposEntrada } from "../db/esquema.js";
import { ErrorNegocio } from "../errores.js";

/** Huella del código del QR (la misma cuenta la hace el celular para buscar en su lista sin señal). */
export const huella = (codigo: string) => createHash("sha256").update(codigo, "utf8").digest("base64url");

async function fiestaDePuerta(db: BaseDeDatos, tokenPuerta: string) {
  const [fiesta] = await db.select().from(fiestas).where(eq(fiestas.tokenPuerta, tokenPuerta)).limit(1);
  if (!fiesta) throw new ErrorNegocio(404, "LINK_INVALIDO", "Este link de puerta no existe o lo cambiaron. Pedile el nuevo al organizador.");
  return fiesta;
}

/** Lo que baja el celular: la fiesta, los tipos y las entradas pagadas, usadas o anuladas (no las que no se pagaron). */
export async function listaDePuerta(db: BaseDeDatos, tokenPuerta: string) {
  const fiesta = await fiestaDePuerta(db, tokenPuerta);
  const tipos = await db.select().from(tiposEntrada).where(eq(tiposEntrada.fiestaId, fiesta.id)).orderBy(asc(tiposEntrada.orden));
  const lista = await db.select().from(entradas).where(eq(entradas.fiestaId, fiesta.id)).orderBy(asc(entradas.nombre));
  return {
    fiesta: { nombre: fiesta.nombre, fechaHora: fiesta.fechaHora.toISOString(), lugar: fiesta.lugar },
    tipos: tipos.map((t) => ({ id: t.id, nombre: t.nombre })),
    entradas: lista
      .filter((e) => e.estado !== "PENDIENTE_PAGO")
      .map((e) => ({
        id: e.id,
        huella: huella(e.codigo),
        nombre: e.nombre,
        dni: e.dni,
        tipoId: e.tipoId,
        estado: e.estado,
        usadaEn: e.usadaEn?.toISOString() ?? null,
        usadaPor: e.usadaPor,
      })),
    actualizadaEn: new Date().toISOString(),
  };
}

export const ingresosSchema = z.object({
  ingresos: z
    .array(
      z
        .object({
          /** Identificador que arma el celular para este ingreso. */
          id: z.string().uuid(),
          /** El texto del QR (si se escaneó) o la entrada elegida a mano. */
          codigo: z.string().min(10).max(100).optional(),
          entradaId: z.string().uuid().optional(),
          por: z.string().trim().min(2, "Escribí tu nombre.").max(40),
          /** Hora en que se marcó en el celular (puede ser antes, si no había señal). */
          en: z.coerce.date(),
        })
        .refine((i) => (i.codigo ? !i.entradaId : !!i.entradaId), { message: "Falta el QR o la entrada." }),
    )
    .min(1)
    .max(200),
});

export type ResultadoIngreso = {
  id: string;
  resultado: "ENTRO" | "YA_ENTRO" | "ANULADA" | "SIN_PAGAR" | "NO_EXISTE";
  entrada: { id: string; nombre: string; dni: string; tipoId: string; usadaEn: string | null; usadaPor: string | null } | null;
};

/** Marca las entradas que entraron. Devuelve, para cada ingreso, si entró o por qué no. */
export async function registrarIngresos(db: BaseDeDatos, actor: Actor, tokenPuerta: string, datos: z.infer<typeof ingresosSchema>, ahora = new Date()) {
  const fiesta = await fiestaDePuerta(db, tokenPuerta);
  const resultados: ResultadoIngreso[] = [];
  for (const ingreso of datos.ingresos) {
    resultados.push(await registrarUno(db, actor, fiesta.id, ingreso, ahora));
  }
  return { resultados };
}

async function registrarUno(db: BaseDeDatos, actor: Actor, fiestaId: string, ingreso: z.infer<typeof ingresosSchema>["ingresos"][number], ahora: Date): Promise<ResultadoIngreso> {
  return db.transaction(async (tx) => {
    const condicion = ingreso.codigo ? eq(entradas.codigo, ingreso.codigo) : eq(entradas.id, ingreso.entradaId as string);
    const [e] = await tx.select().from(entradas).where(and(condicion, eq(entradas.fiestaId, fiestaId))).for("update");
    const datos = (x: typeof e) =>
      x ? { id: x.id, nombre: x.nombre, dni: x.dni, tipoId: x.tipoId, usadaEn: x.usadaEn?.toISOString() ?? null, usadaPor: x.usadaPor } : null;
    if (!e) return { id: ingreso.id, resultado: "NO_EXISTE", entrada: null };
    if (e.estado === "ANULADA") return { id: ingreso.id, resultado: "ANULADA", entrada: datos(e) };
    if (e.estado === "PENDIENTE_PAGO") return { id: ingreso.id, resultado: "SIN_PAGAR", entrada: datos(e) };
    if (e.estado === "USADA") {
      // Si es el mismo ingreso que se reintenta, ya había entrado con este celular: va como "entró".
      return { id: ingreso.id, resultado: e.ingresoId === ingreso.id ? "ENTRO" : "YA_ENTRO", entrada: datos(e) };
    }
    // La hora es la del celular (si no tenía señal, marcó antes), pero nunca en el futuro ni de más de 2 días atrás.
    const en = ingreso.en > ahora || ingreso.en.getTime() < ahora.getTime() - 2 * 86_400_000 ? ahora : ingreso.en;
    const [usada] = await tx
      .update(entradas)
      .set({ estado: "USADA", usadaEn: en, usadaPor: ingreso.por, ingresoId: ingreso.id, ingresoManual: !ingreso.codigo })
      .where(and(eq(entradas.id, e.id), eq(entradas.estado, "VALIDA")))
      .returning();
    await registrarAuditoria(tx, actor, {
      accion: "ENTRADA_USADA",
      entidad: "entradas",
      entidadId: e.id,
      despues: { por: ingreso.por, en: en.toISOString(), manual: !ingreso.codigo },
    });
    return { id: ingreso.id, resultado: "ENTRO", entrada: datos(usada) };
  });
}
