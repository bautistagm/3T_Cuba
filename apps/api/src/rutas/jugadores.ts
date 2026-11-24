import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BaseDeDatos } from "../db/cliente.js";
import {
  analizarImportacion,
  cambiosJugadorSchema,
  crearJugador,
  darDeBaja,
  datosJugadorSchema,
  editarJugador,
  eliminarJugador,
  importarJugadores,
  listarJugadores,
  reactivar,
  TAMANO_MAXIMO_CSV,
} from "../jugadores/jugadores.js";
import { actorDe, idSchema, requiereDueno, requiereSesion } from "./comun.js";

const csvSchema = z.object({ csv: z.string().min(1, "El archivo está vacío.").max(TAMANO_MAXIMO_CSV, "El archivo es demasiado grande.") });
const LIMITE_CSV = TAMANO_MAXIMO_CSV * 2;

export function rutasJugadores(api: FastifyInstance, db: BaseDeDatos) {
  api.get("/jugadores", async (peticion) => {
    requiereSesion(peticion);
    const filtro = z
      .object({ estado: z.enum(["ACTIVO", "BAJA", "TODOS"]).optional(), buscar: z.string().max(60).optional() })
      .parse(peticion.query);
    return listarJugadores(db, filtro);
  });

  api.post("/jugadores", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const jugador = await crearJugador(db, actor, datosJugadorSchema.parse(peticion.body));
    return respuesta.status(201).send({ jugador });
  });

  api.patch("/jugadores/:id", async (peticion) => {
    const actor = actorDe(peticion);
    return { jugador: await editarJugador(db, actor, idSchema.parse(peticion.params).id, cambiosJugadorSchema.parse(peticion.body)) };
  });

  api.post("/jugadores/:id/baja", async (peticion) => {
    return { jugador: await darDeBaja(db, actorDe(peticion), idSchema.parse(peticion.params).id) };
  });

  api.post("/jugadores/:id/reactivar", async (peticion) => {
    return { jugador: await reactivar(db, actorDe(peticion), idSchema.parse(peticion.params).id) };
  });

  api.post("/jugadores/:id/eliminar", async (peticion) => {
    const { confirmacion } = z.object({ confirmacion: z.string().max(140) }).parse(peticion.body);
    return eliminarJugador(db, actorDe(peticion), idSchema.parse(peticion.params).id, confirmacion);
  });

  api.post("/jugadores/importar/analizar", { bodyLimit: LIMITE_CSV }, async (peticion) => {
    requiereDueno(peticion);
    const { csv } = csvSchema.parse(peticion.body);
    const r = await analizarImportacion(db, csv);
    return { ...r, filas: r.filas.map((f) => ({ fila: f.fila, nombre: f.nombre, apellido: f.apellido, dni: f.dni, camada: f.camada, estado: f.estado, motivo: f.motivo })) };
  });

  api.post("/jugadores/importar", { bodyLimit: LIMITE_CSV }, async (peticion) => {
    requiereDueno(peticion);
    const { csv } = csvSchema.parse(peticion.body);
    return importarJugadores(db, actorDe(peticion), csv);
  });
}
