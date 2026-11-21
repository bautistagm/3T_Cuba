import "dotenv/config";
import pg from "pg";
import { construirApp } from "./app.js";
import { asegurarCuentasBase } from "./caja/cuentas.js";
import { leerConfig } from "./config.js";
import { aplicarMigraciones, conectarBase } from "./db/cliente.js";

const config = leerConfig();
const conexion = conectarBase(config.DATABASE_URL);

const aviso = (texto: string) => console.log(`[arranque] ${texto}`);

/**
 * Si preparar la base tarda demasiado (por ejemplo, porque otra conexión la tiene trabada),
 * cada 20 segundos se muestra en el registro qué está pasando en la base, y a los 3 minutos
 * se corta con un error claro en lugar de quedar colgado.
 */
async function contarQuePasa(): Promise<void> {
  const cliente = new pg.Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  try {
    await cliente.connect();
    const { rows } = await cliente.query(`
      select pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) as bloqueado_por,
             now() - xact_start as transaccion_hace, left(regexp_replace(query, '\\s+', ' ', 'g'), 140) as consulta
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
      order by xact_start nulls last`);
    aviso(`conexiones en la base: ${rows.length}`);
    for (const f of rows) aviso(JSON.stringify(f));
  } catch (e) {
    aviso(`no pude revisar la base: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

async function prepararBase(): Promise<void> {
  const inicio = Date.now();
  const revisar = setInterval(() => {
    aviso(`la base sigue sin estar lista después de ${Math.round((Date.now() - inicio) / 1000)} s`);
    void contarQuePasa();
  }, 20_000);
  const limite = setTimeout(() => {
    aviso("ERROR: la base no quedó lista en 3 minutos. Corto el arranque.");
    process.exit(1);
  }, 180_000);
  try {
    aviso("aplicando cambios a la base…");
    await aplicarMigraciones(conexion.db);
    aviso("cambios aplicados; revisando cuentas base…");
    await asegurarCuentasBase(conexion.db);
    aviso(`base lista en ${Date.now() - inicio} ms`);
  } finally {
    clearInterval(revisar);
    clearTimeout(limite);
  }
}

await prepararBase();

const app = await construirApp({ db: conexion.db, config });
await app.listen({ port: config.PUERTO, host: "0.0.0.0" });

const apagar = async () => {
  await app.close();
  await conexion.cerrar();
  process.exit(0);
};
process.on("SIGTERM", () => void apagar());
process.on("SIGINT", () => void apagar());
