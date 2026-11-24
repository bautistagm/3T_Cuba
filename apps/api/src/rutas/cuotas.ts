import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  abrirMes,
  agregarCuota,
  aliasDelPlantel,
  anularCuota,
  cambiarMontoDelMes,
  cobrarCuotasEnEfectivo,
  cuotasDeJugador,
  deudores,
  fijarAlias,
  listarMeses,
} from "../cuotas/cuotas.js";
import type { BaseDeDatos } from "../db/cliente.js";
import { actorDe, idSchema, montoSchema, motivoSchema, requiereSesion, textoOpcional } from "./comun.js";

export function rutasCuotas(api: FastifyInstance, db: BaseDeDatos) {
  api.get("/cuotas/meses", async (peticion) => {
    requiereSesion(peticion);
    return { meses: await listarMeses(db), alias: await aliasDelPlantel(db) };
  });

  api.post("/cuotas/meses", async (peticion, respuesta) => {
    const datos = z
      .object({
        anio: z.number().int().min(2026).max(2100),
        mes: z.number().int().min(1).max(12),
        montoCentavos: montoSchema,
        nota: textoOpcional(200),
      })
      .parse(peticion.body);
    return respuesta.status(201).send(await abrirMes(db, actorDe(peticion), datos));
  });

  api.put("/cuotas/meses/:id/monto", async (peticion) => {
    const { montoCentavos } = z.object({ montoCentavos: montoSchema }).parse(peticion.body);
    await cambiarMontoDelMes(db, actorDe(peticion), idSchema.parse(peticion.params).id, montoCentavos);
    return { ok: true };
  });

  api.get("/cuotas/deudores", async (peticion) => {
    requiereSesion(peticion);
    const { periodoId } = z.object({ periodoId: z.string().uuid().optional() }).parse(peticion.query);
    return { ...(await deudores(db, periodoId)), alias: await aliasDelPlantel(db) };
  });

  api.get("/jugadores/:id/cuotas", async (peticion) => {
    requiereSesion(peticion);
    return cuotasDeJugador(db, idSchema.parse(peticion.params).id);
  });

  api.post("/jugadores/:id/cuotas", async (peticion, respuesta) => {
    const { periodoId } = z.object({ periodoId: z.string().uuid() }).parse(peticion.body);
    const cuota = await agregarCuota(db, actorDe(peticion), idSchema.parse(peticion.params).id, periodoId);
    return respuesta.status(201).send({ cuota });
  });

  api.post("/cuotas/:id/anular", async (peticion) => {
    const { motivo } = motivoSchema.parse(peticion.body);
    return { cuota: await anularCuota(db, actorDe(peticion), idSchema.parse(peticion.params).id, motivo) };
  });

  api.post("/jugadores/:id/pagos-efectivo", async (peticion, respuesta) => {
    const { cuotas, nota } = z
      .object({ cuotas: z.array(z.string().uuid()).min(1, "Elegí al menos una cuota.").max(24), nota: textoOpcional(300) })
      .parse(peticion.body);
    const pago = await cobrarCuotasEnEfectivo(db, actorDe(peticion), idSchema.parse(peticion.params).id, cuotas, nota);
    return respuesta.status(201).send({ pago });
  });

  api.put("/parametros/alias", async (peticion) => {
    const { alias } = z.object({ alias: z.string().max(40) }).parse(peticion.body);
    await fijarAlias(db, actorDe(peticion), alias);
    return { alias: alias.trim() };
  });
}
