import { eq } from "drizzle-orm";
import type { Ejecutor } from "../db/cliente.js";
import { cuentasCaja } from "../db/esquema.js";

type TipoCuenta = "ACTIVO" | "INGRESO" | "EGRESO";

/** Cuentas que existen siempre. Agregar una nueva acá no rompe nada: se crea al arrancar si falta. */
export const CUENTAS_BASE: readonly { codigo: string; nombre: string; tipo: TipoCuenta }[] = [
  { codigo: "CUENTA", nombre: "Cuenta del plantel (alias)", tipo: "ACTIVO" },
  { codigo: "INGRESO:CUOTAS", nombre: "Cuotas", tipo: "INGRESO" },
  { codigo: "INGRESO:INVITADOS", nombre: "Invitados del tercer tiempo", tipo: "INGRESO" },
  { codigo: "INGRESO:FIESTAS", nombre: "Entradas de fiestas", tipo: "INGRESO" },
  { codigo: "INGRESO:OTROS", nombre: "Otros ingresos", tipo: "INGRESO" },
  { codigo: "EGRESO:CARNE", nombre: "Carne", tipo: "EGRESO" },
  { codigo: "EGRESO:BEBIDAS", nombre: "Bebidas", tipo: "EGRESO" },
  { codigo: "EGRESO:INSUMOS", nombre: "Insumos (hielo, carbón, descartables)", tipo: "EGRESO" },
  { codigo: "EGRESO:COCINA_CAMADAS", nombre: "Cocina de camadas", tipo: "EGRESO" },
  { codigo: "EGRESO:FIESTAS", nombre: "Gastos de fiestas", tipo: "EGRESO" },
  { codigo: "EGRESO:OTROS", nombre: "Otros gastos", tipo: "EGRESO" },
];

export function codigoEfectivo(adminId: string): string {
  return `EFECTIVO:${adminId}`;
}

/** Crea las cuentas base que falten. Se puede correr las veces que haga falta. */
export async function asegurarCuentasBase(ejecutor: Ejecutor): Promise<void> {
  await ejecutor
    .insert(cuentasCaja)
    .values(CUENTAS_BASE.map((c) => ({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo })))
    .onConflictDoNothing({ target: cuentasCaja.codigo });
}

/** Cada admin tiene su cuenta de efectivo: la plata que cobró en mano y todavía no rindió. */
export async function crearCuentaEfectivo(ejecutor: Ejecutor, admin: { id: string; nombre: string }): Promise<void> {
  await ejecutor
    .insert(cuentasCaja)
    .values({ codigo: codigoEfectivo(admin.id), nombre: `Efectivo de ${admin.nombre}`, tipo: "ACTIVO", adminId: admin.id })
    .onConflictDoNothing({ target: cuentasCaja.codigo });
}

export async function buscarCuentaPorCodigo(ejecutor: Ejecutor, codigo: string) {
  const [cuenta] = await ejecutor.select().from(cuentasCaja).where(eq(cuentasCaja.codigo, codigo)).limit(1);
  return cuenta ?? null;
}
