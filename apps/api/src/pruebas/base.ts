/**
 * Ayudas para los tests de integración: usan una base PostgreSQL real, aparte de la de desarrollo.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { asegurarCuentasBase } from "../caja/cuentas.js";
import { aplicarMigraciones, conectarBase, type ConexionBase } from "../db/cliente.js";
import type { Config } from "../config.js";

export function urlBaseDePrueba(): string {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL_TEST para correr los tests de integración.");
  if (!/test/i.test(url)) {
    throw new Error("Por seguridad, los tests solo corren contra una base cuyo nombre incluya 'test'.");
  }
  return url;
}

/** Deja la base de prueba vacía y con todas las migraciones aplicadas. */
export async function prepararBaseLimpia(): Promise<ConexionBase> {
  const conexion = conectarBase(urlBaseDePrueba());
  await conexion.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await conexion.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await conexion.db.execute(sql`CREATE SCHEMA public`);
  await aplicarMigraciones(conexion.db);
  await asegurarCuentasBase(conexion.db);
  return conexion;
}

export const configDePrueba: Config = {
  NODE_ENV: "test",
  PUERTO: 0,
  DATABASE_URL: "postgresql://ignorado/test",
  SESION_DIAS: 30,
  CODIGO_INSTALACION: "codigo-de-prueba-123",
};
