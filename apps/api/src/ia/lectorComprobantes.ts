/**
 * Lectura de comprobantes de transferencia con IA (Gemini, plan gratis).
 *
 * La IA solo PROPONE lo que leyó. Quien decide si el pago se confirma es verificacion/cruce.ts,
 * comparando contra los movimientos reales de la cuenta. Nunca se confía en la IA sin verificar.
 */
import { GoogleGenAI } from "@google/genai";
import { conModelos, explicarErrorIa } from "./gemini.js";
import { z } from "zod";

export const lecturaComprobanteSchema = z.object({
  es_comprobante: z.boolean(),
  legible: z.boolean(),
  fecha_hora: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    .nullable(),
  monto_centavos: z.number().int().safe().nullable(),
  nombre_pagador: z.string().trim().max(120).nullable(),
  cuit_pagador: z.string().trim().max(20).nullable(),
  banco_origen: z.string().trim().max(80).nullable(),
  nombre_destinatario: z.string().trim().max(120).nullable(),
  cuit_destinatario: z.string().trim().max(20).nullable(),
  numero_operacion: z.string().trim().max(80).nullable(),
  observaciones: z.string().max(500).nullable(),
});

export type LecturaComprobante = z.infer<typeof lecturaComprobanteSchema>;
export type LectorComprobantes = (imagen: { contenido: Buffer; tipoMime: string }) => Promise<LecturaComprobante>;

export class ErrorLectorComprobantes extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorLectorComprobantes";
  }
}

const ESQUEMA_RESPUESTA = {
  type: "object",
  properties: {
    es_comprobante: { type: "boolean", description: "true si la imagen es un comprobante de transferencia bancaria o de billetera virtual" },
    legible: { type: "boolean", description: "true si se leen con seguridad el monto y la fecha" },
    fecha_hora: { type: ["string", "null"], description: "Fecha y hora de la transferencia, hora de Argentina, formato AAAA-MM-DDTHH:MM (o AAAA-MM-DD si no hay hora)" },
    monto_centavos: { type: ["integer", "null"], description: "Monto transferido en centavos de peso (ej.: $15.000 = 1500000; $1 = 100)" },
    nombre_pagador: { type: ["string", "null"], description: "Nombre de quien ENVÍA la plata (origen)" },
    cuit_pagador: { type: ["string", "null"], description: "CUIT/CUIL/CUIT de quien ENVÍA (origen), tal como figura" },
    banco_origen: { type: ["string", "null"], description: "Banco o billetera desde donde se transfirió" },
    nombre_destinatario: { type: ["string", "null"], description: "Nombre de quien RECIBE (destino)" },
    cuit_destinatario: { type: ["string", "null"], description: "CUIT/CUIL de quien RECIBE (destino)" },
    numero_operacion: {
      type: ["string", "null"],
      description:
        "Número o código principal de la operación (ej. 'N.º de operación de Mercado Pago', 'Número de transacción', 'ID de operación', 'Código de identificación'). Copialo exacto.",
    },
    observaciones: { type: ["string", "null"], description: "Dudas sobre la lectura o señales de que la imagen está editada" },
  },
  required: [
    "es_comprobante",
    "legible",
    "fecha_hora",
    "monto_centavos",
    "nombre_pagador",
    "cuit_pagador",
    "banco_origen",
    "nombre_destinatario",
    "cuit_destinatario",
    "numero_operacion",
    "observaciones",
  ],
} as const;

const INSTRUCCIONES = `Sos un asistente que lee comprobantes de transferencias de Argentina (Mercado Pago, bancos, Ualá, Brubank, etc.).
Leé la imagen y devolvé SOLO el JSON pedido.
Reglas:
- Los montos argentinos usan punto para miles y coma para decimales: "$16.400,50" son 1640050 centavos. "$ 1" son 100 centavos.
- El ORIGEN es quien manda la plata (pagador) y el DESTINO quien la recibe. No los confundas.
- Copiá los números (CUIT/CUIL, número de operación) exactamente como aparecen.
- Si la imagen no es un comprobante de transferencia, poné es_comprobante=false.
- Si parece editada, recortada o hay algo raro, decilo en observaciones.
- No inventes datos: si algo no se lee, poné null o legible=false.`;

/** Lector real con Gemini. Prueba los modelos en orden si alguno está saturado o ya no existe. */
export function crearLectorComprobantesGemini(opciones: { apiKey: string; modelos: readonly string[] }): LectorComprobantes {
  const ia = new GoogleGenAI({ apiKey: opciones.apiKey, apiVersion: "v1beta", httpOptions: { timeout: 45_000 } });
  return async ({ contenido, tipoMime }) => {
    try {
      return await conModelos(opciones.modelos, async (modelo) => {
        const respuesta = await ia.models.generateContent({
          model: modelo,
          contents: [
            { role: "user", parts: [{ inlineData: { mimeType: tipoMime, data: contenido.toString("base64") } }, { text: INSTRUCCIONES }] },
          ],
          config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: ESQUEMA_RESPUESTA },
        });
        const texto = respuesta.text;
        if (!texto) throw new ErrorLectorComprobantes("La IA no devolvió respuesta.");
        const lectura = lecturaComprobanteSchema.safeParse(JSON.parse(texto));
        if (!lectura.success) throw new ErrorLectorComprobantes("La IA devolvió datos con un formato inesperado.");
        return lectura.data;
      });
    } catch (error) {
      throw new ErrorLectorComprobantes(`No se pudo leer el comprobante: ${explicarErrorIa(error)}`);
    }
  };
}

export const lectorComprobantesSinIa: LectorComprobantes = async () => {
  throw new ErrorLectorComprobantes("La lectura con IA no está configurada (falta GEMINI_API_KEY).");
};

/** Pasa la fecha leída (hora de Argentina) a un momento exacto. Si es solo el día, toma el mediodía. */
export function fechaDeLectura(fecha: string | null): Date | null {
  if (!fecha) return null;
  const iso = fecha.length === 10 ? `${fecha}T12:00:00-03:00` : `${fecha}:00-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
