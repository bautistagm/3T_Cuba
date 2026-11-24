/**
 * Asistente de texto con IA (Gemini, plan gratis) para explicar y responder preguntas sobre la plata.
 * Solo recibe un resumen de los números (nunca datos personales de jugadores) y tiene que responder
 * únicamente con esos datos.
 */
import { GoogleGenAI } from "@google/genai";
import { conModelos, explicarErrorIa } from "./gemini.js";

export type AsistenteIa = (instrucciones: string, datos: unknown, pregunta: string) => Promise<string>;

export class ErrorAsistenteIa extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorAsistenteIa";
  }
}

export const REGLAS_ASISTENTE = `Sos el asistente de la caja del tercer tiempo de un plantel de rugby en Argentina.
Respondé en español rioplatense, claro y corto (máximo 5 oraciones), sin tecnicismos.
Usá SOLO los datos que te paso en JSON. Si con esos datos no se puede responder, decilo.
Los montos en los datos están en centavos: mostralos en pesos con formato argentino ($16.400). No inventes números.`;

export function crearAsistenteGemini(opciones: { apiKey: string; modelos: readonly string[] }): AsistenteIa {
  const ia = new GoogleGenAI({ apiKey: opciones.apiKey, apiVersion: "v1beta", httpOptions: { timeout: 45_000 } });
  return async (instrucciones, datos, pregunta) => {
    try {
      return await conModelos(opciones.modelos, async (modelo) => {
        const respuesta = await ia.models.generateContent({
          model: modelo,
          contents: [
            {
              role: "user",
              parts: [{ text: `${instrucciones}\n\nDATOS (JSON):\n${JSON.stringify(datos)}\n\nPREGUNTA: ${pregunta}` }],
            },
          ],
          config: { temperature: 0.2, maxOutputTokens: 600 },
        });
        const texto = respuesta.text?.trim();
        if (!texto) throw new ErrorAsistenteIa("La IA no devolvió respuesta.");
        return texto;
      });
    } catch (error) {
      throw new ErrorAsistenteIa(explicarErrorIa(error));
    }
  };
}

export const asistenteSinIa: AsistenteIa = async () => {
  throw new ErrorAsistenteIa("La IA no está configurada (falta GEMINI_API_KEY).");
};
