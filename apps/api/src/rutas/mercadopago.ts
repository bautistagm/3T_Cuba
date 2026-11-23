import type { FastifyInstance } from "fastify";
import { probarConexion } from "../mercadopago/prueba.js";
import { requiereDueno } from "./comun.js";

export function rutasMercadoPago(api: FastifyInstance, clave: string | undefined, fetchMp?: typeof fetch) {
  /** Prueba de conexión: solo el dueño, porque muestra movimientos de su cuenta personal. No guarda nada. */
  api.get(
    "/mercadopago/prueba",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (peticion) => {
      requiereDueno(peticion);
      return probarConexion(clave, fetchMp ? { fetch: fetchMp } : {});
    },
  );
}
