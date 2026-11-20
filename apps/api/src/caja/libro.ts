/**
 * Libro de caja: la única puerta para registrar plata.
 *
 * Todas las funciones que escriben reciben una TRANSACCIÓN (no la base suelta):
 * el asiento, sus movimientos y su registro de auditoría se guardan juntos o no se guarda nada.
 * La base de datos vuelve a verificar las mismas reglas (ver migración 0001_protecciones.sql).
 */
import { eq, inArray, sql } from "drizzle-orm";
import { sumarCentavos } from "@3t/shared";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import type { Ejecutor, Transaccion } from "../db/cliente.js";
import { asientosCaja, cuentasCaja, movimientosCaja } from "../db/esquema.js";

export class ErrorCaja extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorCaja";
  }
}

export type OrigenAsiento = "PAGO" | "GASTO" | "RENDICION" | "AJUSTE";

export interface LineaAsiento {
  cuentaCodigo: string;
  montoCentavos: bigint;
}

export interface DatosAsiento {
  fecha: Date;
  descripcion: string;
  origen: OrigenAsiento;
  origenId?: string | undefined;
  lineas: readonly LineaAsiento[];
}

export type ActorAdmin = Extract<Actor, { tipo: "ADMIN" }> & { rol: "DUENO" | "ADMIN" };

function validarLineas(lineas: readonly LineaAsiento[]): void {
  if (lineas.length < 2) {
    throw new ErrorCaja("Un asiento necesita al menos dos movimientos: de dónde sale la plata y adónde va.");
  }
  for (const linea of lineas) {
    if (typeof linea.montoCentavos !== "bigint") {
      throw new ErrorCaja("Los montos tienen que ser enteros en centavos (bigint).");
    }
    if (linea.montoCentavos === 0n) {
      throw new ErrorCaja("Ningún movimiento puede ser de $0.");
    }
  }
  const total = sumarCentavos(lineas.map((l) => l.montoCentavos));
  if (total !== 0n) {
    throw new ErrorCaja(`El asiento no está balanceado: suma ${total} centavos y tiene que sumar 0.`);
  }
}

/** Registra un asiento balanceado. Devuelve su id. */
export async function registrarAsiento(tx: Transaccion, actor: Actor, datos: DatosAsiento): Promise<string> {
  validarLineas(datos.lineas);
  if (!datos.descripcion.trim()) throw new ErrorCaja("El asiento necesita una descripción.");

  const codigos = [...new Set(datos.lineas.map((l) => l.cuentaCodigo))];
  const cuentas = await tx
    .select({ id: cuentasCaja.id, codigo: cuentasCaja.codigo, activa: cuentasCaja.activa })
    .from(cuentasCaja)
    .where(inArray(cuentasCaja.codigo, codigos));
  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  for (const codigo of codigos) {
    const cuenta = porCodigo.get(codigo);
    if (!cuenta) throw new ErrorCaja(`La cuenta ${codigo} no existe.`);
    if (!cuenta.activa) throw new ErrorCaja(`La cuenta ${codigo} está desactivada.`);
  }

  const [asiento] = await tx
    .insert(asientosCaja)
    .values({
      fecha: datos.fecha,
      descripcion: datos.descripcion.trim(),
      origen: datos.origen,
      origenId: datos.origenId ?? null,
      creadoPorAdminId: actor.tipo === "ADMIN" ? actor.adminId : null,
    })
    .returning({ id: asientosCaja.id });
  if (!asiento) throw new ErrorCaja("No se pudo crear el asiento.");

  await tx.insert(movimientosCaja).values(
    datos.lineas.map((l) => {
      const cuenta = porCodigo.get(l.cuentaCodigo);
      if (!cuenta) throw new ErrorCaja(`La cuenta ${l.cuentaCodigo} no existe.`);
      return { asientoId: asiento.id, cuentaId: cuenta.id, montoCentavos: l.montoCentavos };
    }),
  );

  await registrarAuditoria(tx, actor, {
    accion: "CAJA_ASIENTO_REGISTRADO",
    entidad: "asiento_caja",
    entidadId: asiento.id,
    despues: { ...datos, origenId: datos.origenId ?? null },
  });

  return asiento.id;
}

/**
 * Anula un asiento creando su espejo (mismas cuentas, montos opuestos). El original queda intacto.
 * Solo el dueño puede anular, y tiene que dar un motivo.
 */
export async function anularAsiento(
  tx: Transaccion,
  actor: ActorAdmin,
  datos: { asientoId: string; motivo: string },
): Promise<string> {
  if (actor.rol !== "DUENO") throw new ErrorCaja("Solo el dueño puede anular movimientos de caja.");
  const motivo = datos.motivo.trim();
  if (motivo.length < 5) throw new ErrorCaja("Para anular hay que escribir el motivo.");

  // Bloqueamos el asiento original para que dos anulaciones simultáneas no compitan.
  const [original] = await tx
    .select()
    .from(asientosCaja)
    .where(eq(asientosCaja.id, datos.asientoId))
    .for("update");
  if (!original) throw new ErrorCaja("El asiento no existe.");
  if (original.origen === "ANULACION") throw new ErrorCaja("No se puede anular una anulación.");

  const [yaAnulado] = await tx
    .select({ id: asientosCaja.id })
    .from(asientosCaja)
    .where(eq(asientosCaja.anulaAsientoId, original.id))
    .limit(1);
  if (yaAnulado) throw new ErrorCaja("Este asiento ya fue anulado.");

  const movimientos = await tx
    .select({ cuentaId: movimientosCaja.cuentaId, montoCentavos: movimientosCaja.montoCentavos })
    .from(movimientosCaja)
    .where(eq(movimientosCaja.asientoId, original.id));

  const [anulacion] = await tx
    .insert(asientosCaja)
    .values({
      fecha: new Date(),
      descripcion: `Anulación: ${original.descripcion}. Motivo: ${motivo}`,
      origen: "ANULACION",
      origenId: original.origenId,
      anulaAsientoId: original.id,
      creadoPorAdminId: actor.adminId,
    })
    .returning({ id: asientosCaja.id });
  if (!anulacion) throw new ErrorCaja("No se pudo crear la anulación.");

  await tx.insert(movimientosCaja).values(
    movimientos.map((m) => ({ asientoId: anulacion.id, cuentaId: m.cuentaId, montoCentavos: -m.montoCentavos })),
  );

  await registrarAuditoria(tx, actor, {
    accion: "CAJA_ASIENTO_ANULADO",
    entidad: "asiento_caja",
    entidadId: original.id,
    despues: { anulacionId: anulacion.id, motivo },
  });

  return anulacion.id;
}

/** Saldo de una cuenta: la suma de todos sus movimientos (incluidas anulaciones). */
export async function saldoDeCuenta(ejecutor: Ejecutor, cuentaCodigo: string): Promise<bigint> {
  const [fila] = await ejecutor
    .select({ saldo: sql<string>`coalesce(sum(${movimientosCaja.montoCentavos}), 0)::text` })
    .from(movimientosCaja)
    .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
    .where(eq(cuentasCaja.codigo, cuentaCodigo));
  return BigInt(fila?.saldo ?? "0");
}

/** Plata disponible: suma de todas las cuentas de activo (cuenta del alias + efectivo de cada admin). */
export async function saldoDisponible(ejecutor: Ejecutor): Promise<bigint> {
  const [fila] = await ejecutor
    .select({ saldo: sql<string>`coalesce(sum(${movimientosCaja.montoCentavos}), 0)::text` })
    .from(movimientosCaja)
    .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
    .where(eq(cuentasCaja.tipo, "ACTIVO"));
  return BigInt(fila?.saldo ?? "0");
}
