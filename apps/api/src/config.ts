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
  /**
   * Clave secreta para que el servicio externo (cron-job.org) le pida a la app que lea la cuenta cada 10 minutos.
   * Va en el encabezado "x-clave-lectura". Sin ella, la cuenta solo se lee cuando alguien abre la app.
   */
  CLAVE_LECTURA: z.string().min(24).optional(),
  /** Casilla desde la que salen los emails con las entradas. */
  EMAIL_USUARIO: z.string().email().default("plantelcuba@gmail.com"),
  /**
   * Credenciales de la app en Google Cloud (gratis) para mandar emails por la API de Gmail.
   * Render bloquea el SMTP en el plan gratis, por eso no se usa la contraseña de aplicación. Ver docs/PUBLICAR.md, paso 7.
   */
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  /** Dirección pública de la app, para los links de los emails. */
  URL_PUBLICA: z.string().url().default("https://plantel-3t.onrender.com"),
  /** Clave gratis de Google AI Studio para leer tickets. Sin ella, los tickets quedan para cargar a mano. */
  GEMINI_API_KEY: z.string().min(10).optional(),
  /**
   * Access Token de producción de Mercado Pago (de la cuenta del dueño). La app lo usa SOLO para consultar
   * movimientos (ver mercadopago/cliente.ts). Sin él, todas las transferencias las confirma una persona.
   */
  MP_ACCESS_TOKEN: z.string().min(10).optional(),
  /** Modelos de Gemini a usar, en orden de preferencia (si uno falla o se satura, se prueba el siguiente). */
  GEMINI_MODELOS: z
    .string()
    .default("gemini-3.8-flash,gemini-3.5-flash-lite")
    .transform((t) => t.split(",").map((m) => m.trim()).filter(Boolean)),
});

export type Config = z.output<typeof esquemaConfig>;

/** Lee y valida la configuración. Si falta algo, la app no arranca (mejor que arrancar mal). */
export function leerConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquemaConfig.safeParse(entorno);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  return resultado.data;
}
