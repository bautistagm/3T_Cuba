/**
 * Crea la cuenta del dueño. Se usa una sola vez, al instalar la app:
 *
 *   pnpm --filter @3t/api crear-dueno
 *
 * Pide los datos por la terminal. La contraseña no se muestra mientras se escribe
 * y nunca queda guardada en ningún archivo.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { crearDueno } from "../admins/admins.js";
import { asegurarCuentasBase } from "../caja/cuentas.js";
import { leerConfig } from "../config.js";
import { aplicarMigraciones, conectarBase } from "../db/cliente.js";

async function preguntarOculto(pregunta: string): Promise<string> {
  stdout.write(pregunta);
  stdin.setRawMode(true);
  stdin.resume();
  let texto = "";
  return new Promise((resolver) => {
    const alTeclear = (dato: Buffer) => {
      const caracter = dato.toString("utf8");
      if (caracter === "\r" || caracter === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", alTeclear);
        stdout.write("\n");
        resolver(texto);
      } else if (caracter === "\u0003") {
        process.exit(1);
      } else if (caracter === "\u007f") {
        texto = texto.slice(0, -1);
      } else {
        texto += caracter;
      }
    };
    stdin.on("data", alTeclear);
  });
}

const config = leerConfig();
const conexion = conectarBase(config.DATABASE_URL);
try {
  await aplicarMigraciones(conexion.db);
  await asegurarCuentasBase(conexion.db);

  const rl = createInterface({ input: stdin, output: stdout });
  const nombre = await rl.question("Nombre del dueño: ");
  const email = await rl.question("Email: ");
  rl.close();
  const contrasena = await preguntarOculto("Contraseña (mínimo 10 caracteres): ");
  const repetida = await preguntarOculto("Repetila: ");
  if (contrasena !== repetida) throw new Error("Las contraseñas no coinciden.");

  const dueno = await crearDueno(conexion.db, { nombre, email, contrasena });
  console.log(`Listo: ${dueno.nombre} (${dueno.email}) es el dueño de 3T.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await conexion.cerrar();
}
