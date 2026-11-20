import "dotenv/config";
import { construirApp } from "./app.js";
import { asegurarCuentasBase } from "./caja/cuentas.js";
import { leerConfig } from "./config.js";
import { aplicarMigraciones, conectarBase } from "./db/cliente.js";

const config = leerConfig();
const conexion = conectarBase(config.DATABASE_URL);

await aplicarMigraciones(conexion.db);
await asegurarCuentasBase(conexion.db);

const app = await construirApp({ db: conexion.db, config });
await app.listen({ port: config.PUERTO, host: "0.0.0.0" });

const apagar = async () => {
  await app.close();
  await conexion.cerrar();
  process.exit(0);
};
process.on("SIGTERM", () => void apagar());
process.on("SIGINT", () => void apagar());
