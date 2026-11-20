import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cocinaPorToken } from "../cocina/cocina.js";
import type { BaseDeDatos } from "../db/cliente.js";
import type { LectorTickets } from "../ia/lectorTickets.js";
import { descartarTicket, fotoDeTicket, resolverTicket, subirTicketDeCocina, ticketsDeCocina, TAMANO_MAXIMO_IMAGEN } from "../tickets/tickets.js";
import { actorDe, ErrorHttp, idSchema, motivoSchema, requiereSesion, textoOpcional } from "./comun.js";
import { itemsSchema } from "./sabados.js";

/** La foto viaja en base64 dentro del JSON (el celular la achica antes de mandarla). */
export const fotoSchema = z.object({
  imagenBase64: z
    .string()
    .min(100, "La foto está vacía.")
    .max(Math.ceil((TAMANO_MAXIMO_IMAGEN * 4) / 3) + 16, "La foto es demasiado grande.")
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "La foto no llegó bien."),
});
export const LIMITE_CUERPO = 7 * 1024 * 1024;

export function rutasTickets(api: FastifyInstance, db: BaseDeDatos, lector: LectorTickets) {
  api.post("/cocinas/:id/tickets", { bodyLimit: LIMITE_CUERPO }, async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const { imagenBase64 } = fotoSchema.parse(peticion.body);
    const resultado = await subirTicketDeCocina(db, lector, actor, {
      cocinaId: idSchema.parse(peticion.params).id,
      contenido: Buffer.from(imagenBase64, "base64"),
    });
    return respuesta.status(201).send(resultado);
  });

  api.get("/cocinas/:id/tickets", async (peticion) => {
    requiereSesion(peticion);
    return { tickets: await ticketsDeCocina(db, idSchema.parse(peticion.params).id) };
  });

  api.get("/tickets/:id/foto", async (peticion, respuesta) => {
    requiereSesion(peticion);
    const foto = await fotoDeTicket(db, idSchema.parse(peticion.params).id);
    return respuesta.header("content-type", foto.tipoMime).header("cache-control", "private, max-age=3600").send(foto.contenido);
  });

  api.post("/tickets/:id/resolver", async (peticion) => {
    const actor = actorDe(peticion);
    const datos = z.object({ proveedor: textoOpcional(120), items: itemsSchema }).parse(peticion.body);
    return { gasto: await resolverTicket(db, actor, idSchema.parse(peticion.params).id, datos) };
  });

  api.post("/tickets/:id/descartar", async (peticion) => {
    const actor = actorDe(peticion);
    const { motivo } = motivoSchema.parse(peticion.body);
    await descartarTicket(db, actor, idSchema.parse(peticion.params).id, motivo);
    return { ok: true };
  });

  // El responsable de la camada sube tickets desde su link.
  api.post(
    "/publico/cocina/:token/tickets",
    { bodyLimit: LIMITE_CUERPO, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (peticion, respuesta) => {
      const { token } = z.object({ token: z.string().max(100) }).parse(peticion.params);
      const cocina = await cocinaPorToken(db, token);
      if (!cocina) throw new ErrorHttp(404, "LINK_INVALIDO", "Este link no existe o la cocina ya se cerró.");
      const { imagenBase64 } = fotoSchema.parse(peticion.body);
      const resultado = await subirTicketDeCocina(db, lector, { tipo: "PUBLICO", ip: peticion.ip }, {
        cocinaId: cocina.id,
        contenido: Buffer.from(imagenBase64, "base64"),
      });
      return respuesta.status(201).send({ estado: resultado.estado, motivoRevision: resultado.motivoRevision });
    },
  );
}
