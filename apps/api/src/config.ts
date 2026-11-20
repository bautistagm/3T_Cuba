import { z } from "zod";

const esquemaConfig = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUERTO: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  /** Días que dura la sesión de un admin antes de pedir login de nuevo. */
  SESION_DIAS: z.coerce.number().int().min(1).max(90).default(30),
  /**
   * Código que se pide una sola vez para crear la cuenta del dueño desde la web.
   * Lo inventa el dueño y lo carga en el hosting. Sin este código, nadie puede "adueñarse" de la app.
   */
  CODIGO_INSTALACION: z.string().min(12, "CODIGO_INSTALACION tiene que tener al menos 12 caracteres.").optional(),
  /** Carpeta con las pantallas ya compiladas (apps/web/dist). Si no está, la API funciona sola. */
  CARPETA_WEB: z.string().optional(),
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
