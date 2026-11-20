/**
 * Lectura de tickets con IA (Gemini, plan gratis).
 *
 * La IA solo PROPONE lo que leyó. Quien la usa (tickets.ts) decide si los números cierran
 * y, si no, manda el ticket a "Revisar". Nunca se confía en la IA sin verificar.
 */
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { CATEGORIAS } from "../gastos/gastos.js";

const itemLeido = z.object({
  descripcion: z.string().trim().min(1).max(200),
  cantidad: z.string().trim().max(40).nullable(),
  categoria: z.enum(CATEGORIAS),
  importe_centavos: z.number().int().safe(),
});

export const lecturaTicketSchema = z.object({
  es_ticket: z.boolean(),
  legible: z.boolean(),
  proveedor: z.string().trim().max(120).nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  total_centavos: z.number().int().safe().nullable(),
  items: z.array(itemLeido).max(100),
  observaciones: z.string().max(500).nullable(),
});

export type LecturaTicket = z.infer<typeof lecturaTicketSchema>;
export type LectorTickets = (imagen: { contenido: Buffer; tipoMime: string }) => Promise<LecturaTicket>;

export class ErrorLectorIa extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorLectorIa";
  }
}

/** Esquema JSON que se le pide a la IA que respete. */
const ESQUEMA_RESPUESTA = {
  type: "object",
  properties: {
    es_ticket: { type: "boolean", description: "true si la imagen es un ticket, factura o comprobante de compra" },
    legible: { type: "boolean", description: "true si se pueden leer con seguridad los productos y el total" },
    proveedor: { type: ["string", "null"], description: "Nombre del comercio" },
    fecha: { type: ["string", "null"], description: "Fecha de la compra en formato AAAA-MM-DD" },
    total_centavos: { type: ["integer", "null"], description: "Total final pagado, en centavos de peso (ej.: $16.400,50 = 1640050)" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          descripcion: { type: "string" },
          cantidad: { type: ["string", "null"], description: "Cantidad con unidad tal como figura, ej. '15 kg', '6 u'" },
          categoria: { type: "string", enum: [...CATEGORIAS] },
          importe_centavos: { type: "integer", description: "Importe final del renglón en centavos, ya con descuentos aplicados" },
        },
        required: ["descripcion", "cantidad", "categoria", "importe_centavos"],
      },
    },
    observaciones: { type: ["string", "null"], description: "Cualquier duda sobre la lectura" },
  },
  required: ["es_ticket", "legible", "proveedor", "fecha", "total_centavos", "items", "observaciones"],
} as const;

const INSTRUCCIONES = `Sos un asistente que lee tickets de compras de un club de rugby en Argentina (carnicerías, supermercados, verdulerías, distribuidoras de bebidas).
Leé la imagen y devolvé SOLO el JSON pedido.
Reglas:
- Los precios argentinos usan punto para miles y coma para decimales: "$16.400,50" son 1640050 centavos.
- Todos los importes van en CENTAVOS, como números enteros.
- Un renglón por producto, con su importe final (si hay un descuento sobre un producto, restalo de ese producto). No agregues renglones que no estén en el ticket.
- La suma de los importes de los renglones tiene que dar el total del ticket. Si no podés lograr eso con seguridad, poné legible=false y explicá en observaciones.
- Categorías: CARNE (carnes, achuras, embutidos, pollo, hamburguesas/patis), BEBIDAS (cerveza, gaseosas, vino, fernet, agua, hielo NO), INSUMOS (pan, carbón, leña, hielo, descartables, condimentos, aderezos, servilletas), OTROS (todo lo demás).
- Si la imagen no es un ticket de compra, poné es_ticket=false y items vacío.
- No inventes datos: si algo no se lee, poné null o legible=false.`;

/** Lector real con Gemini. Prueba los modelos en orden si alguno está saturado o ya no existe. */
export function crearLectorGemini(opciones: { apiKey: string; modelos: readonly string[] }): LectorTickets {
  // v1beta: la versión de la API donde está documentada la salida con esquema JSON.
  const ia = new GoogleGenAI({ apiKey: opciones.apiKey, apiVersion: "v1beta", httpOptions: { timeout: 45_000 } });
  return async ({ contenido, tipoMime }) => {
    let ultimoError: unknown;
    for (const modelo of opciones.modelos) {
      try {
        const respuesta = await ia.models.generateContent({
          model: modelo,
          contents: [
            {
              role: "user",
              parts: [{ inlineData: { mimeType: tipoMime, data: contenido.toString("base64") } }, { text: INSTRUCCIONES }],
            },
          ],
          config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: ESQUEMA_RESPUESTA },
        });
        const texto = respuesta.text;
        if (!texto) throw new ErrorLectorIa("La IA no devolvió respuesta.");
        const lectura = lecturaTicketSchema.safeParse(JSON.parse(texto));
        if (!lectura.success) throw new ErrorLectorIa("La IA devolvió datos con un formato inesperado.");
        return lectura.data;
      } catch (error) {
        ultimoError = error;
        // Si el problema es del modelo (saturado, no existe, error del servicio), probamos el siguiente.
        const estado = (error as { status?: number }).status;
        if (estado !== undefined && ![404, 429, 500, 503].includes(estado)) break;
      }
    }
    const detalle = ultimoError instanceof Error ? ultimoError.message : "error desconocido";
    throw new ErrorLectorIa(`La IA no pudo leer el ticket (${detalle.slice(0, 200)}).`);
  };
}

/** Cuando no hay clave de IA cargada: los tickets quedan para cargar a mano. */
export const lectorSinIa: LectorTickets = async () => {
  throw new ErrorLectorIa("La lectura con IA no está configurada (falta GEMINI_API_KEY).");
};
