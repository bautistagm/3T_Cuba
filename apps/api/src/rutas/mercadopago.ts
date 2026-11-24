import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BaseDeDatos } from "../db/cliente.js";
import { probarConexion } from "../mercadopago/prueba.js";
import {
  comprobantesParaRevisar,
  confirmarAMano,
  fotoDeComprobante,
  probarComprobante,
  rechazarComprobante,
  verificarDeNuevo,
  type DependenciasVerificacion,
} from "../verificacion/comprobantes.js";
import { actorDe, idSchema, motivoSchema, requiereDueno, requiereSesion } from "./comun.js";
import { fotoSchema, LIMITE_CUERPO } from "./tickets.js";

export function rutasMercadoPago(
  api: FastifyInstance,
  db: BaseDeDatos,
  clave: string | undefined,
  verificacion: DependenciasVerificacion,
  fetchMp?: typeof fetch,
) {
  /** Prueba de conexión: solo el dueño, porque muestra movimientos de su cuenta personal. No guarda nada. */
  api.get("/mercadopago/prueba", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (peticion) => {
    requiereDueno(peticion);
    return probarConexion(clave, fetchMp ? { fetch: fetchMp } : {});
  });

  /** Prueba con un comprobante real: qué leería la IA y qué haría la app. No guarda nada. */
  api.post(
    "/verificacion/probar",
    { bodyLimit: LIMITE_CUERPO, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (peticion) => {
      requiereDueno(peticion);
      const { imagenBase64 } = fotoSchema.parse(peticion.body);
      return probarComprobante(db, verificacion, Buffer.from(imagenBase64, "base64"));
    },
  );

  // Bandeja "Revisar" de comprobantes.
  api.get("/comprobantes/revisar", async (peticion) => {
    requiereSesion(peticion);
    return { comprobantes: await comprobantesParaRevisar(db) };
  });

  api.get("/comprobantes/:id/foto", async (peticion, respuesta) => {
    requiereSesion(peticion);
    const foto = await fotoDeComprobante(db, idSchema.parse(peticion.params).id);
    return respuesta.header("content-type", foto.tipoMime).header("cache-control", "private, max-age=3600").send(foto.contenido);
  });

  api.post("/comprobantes/:id/verificar", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (peticion) => {
    const actor = actorDe(peticion);
    return { comprobante: await verificarDeNuevo(db, verificacion, actor, idSchema.parse(peticion.params).id) };
  });

  api.post("/comprobantes/:id/confirmar", async (peticion) => {
    const actor = actorDe(peticion);
    const { mpPagoId } = z.object({ mpPagoId: z.string().trim().regex(/^\d{4,30}$/, "El número de operación no es válido.") }).parse(peticion.body);
    return { comprobante: await confirmarAMano(db, verificacion, actor, idSchema.parse(peticion.params).id, mpPagoId) };
  });

  api.post("/comprobantes/:id/rechazar", async (peticion) => {
    const actor = actorDe(peticion);
    const { motivo } = motivoSchema.parse(peticion.body);
    return { comprobante: await rechazarComprobante(db, actor, idSchema.parse(peticion.params).id, motivo) };
  });
}
