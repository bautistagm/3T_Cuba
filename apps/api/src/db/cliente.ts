import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as esquema from "./esquema.js";

export type BaseDeDatos = NodePgDatabase<typeof esquema>;
/** Una transacción en curso. Las funciones que tocan plata reciben esto, para que todo pase junto o nada. */
export type Transaccion = Parameters<Parameters<BaseDeDatos["transaction"]>[0]>[0];
/** Cualquiera de las dos: la base o una transacción abierta. */
export type Ejecutor = BaseDeDatos | Transaccion;

export interface ConexionBase {
  db: BaseDeDatos;
  cerrar: () => Promise<void>;
}

export function conectarBase(url: string): ConexionBase {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema: esquema, casing: "snake_case" });
  return { db, cerrar: () => pool.end() };
}

export const CARPETA_MIGRACIONES = fileURLToPath(new URL("../../migraciones", import.meta.url));

export async function aplicarMigraciones(db: BaseDeDatos): Promise<void> {
  await migrate(db, { migrationsFolder: CARPETA_MIGRACIONES });
}
