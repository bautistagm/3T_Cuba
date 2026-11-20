import { z } from "zod";

const esquemaConfig = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUERTO: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  /** Días que dura la sesión de un admin antes de pedir login de nuevo. */
  SESION_DIAS: z.coerce.number().int().min(1).max(90).default(30),
});

export type Config = z.infer<typeof esquemaConfig>;

/** Lee y valida la configuración. Si falta algo, la app no arranca (mejor que arrancar mal). */
export function leerConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquemaConfig.safeParse(entorno);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  return resultado.data;
}
