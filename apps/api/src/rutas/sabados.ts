import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { adelantar, anularMovimientoCocina, cerrarCocina, cocinaDelSabado, cocinaPorToken, crearCocina, gastoDeCocina, regenerarLink, resumenCocina } from "../cocina/cocina.js";
import type { BaseDeDatos } from "../db/cliente.js";
import { admins, sabados } from "../db/esquema.js";
import { anularGasto, CATEGORIAS, editarGasto, eliminarGasto } from "../gastos/gastos.js";
import { antesDeEliminarSabado, eliminarSabado, eliminarSabadoSchema } from "../sabados/eliminar.js";
import { sabadoCorrespondiente } from "../sabados/fechas.js";
import { ticketsDeCocina } from "../tickets/tickets.js";
import {
  anularPago,
  buscarSabado,
  cobrarInvitado,
  cobrosDelSabado,
  fijarPrecioInvitado,
  listarSabados,
  marcarLocal,
  obtenerOCrearSabado,
  precioInvitado,
} from "../sabados/sabados.js";
import { actorDe, ErrorHttp, idSchema, montoSchema, motivoSchema, requiereSesion, textoOpcional } from "./comun.js";

export const itemsSchema = z
  .array(
    z.object({
      descripcion: z.string().trim().min(1, "Falta la descripción de un producto.").max(200),
      cantidad: textoOpcional(40),
      categoria: z.enum(CATEGORIAS),
      subtotalCentavos: montoSchema,
    }),
  )
  .min(1, "Agregá al menos un producto.")
  .max(100);

export function rutasSabados(api: FastifyInstance, db: BaseDeDatos) {
  async function detalleSabado(sabadoId: string) {
    const sabado = await buscarSabado(db, sabadoId);
    const [cobros, cocina, precio, nombres] = await Promise.all([
      cobrosDelSabado(db, sabado.id),
      cocinaDelSabado(db, sabado.id),
      precioInvitado(db),
      db.select({ id: admins.id, nombre: admins.nombre }).from(admins),
    ]);
    const vigentes = cobros.filter((c) => c.estado === "CONFIRMADO");
    return {
      sabado,
      precioInvitadoCentavos: precio,
      invitados: vigentes.length,
      cobradoCentavos: vigentes.reduce((t, c) => t + c.montoCentavos, 0n),
      cobros,
      cocina,
      nombresAdmins: Object.fromEntries(nombres.map((a) => [a.id, a.nombre])),
    };
  }

  api.get("/sabados/actual", async (peticion) => {
    requiereSesion(peticion);
    const sabado = await obtenerOCrearSabado(db, sabadoCorrespondiente());
    return detalleSabado(sabado.id);
  });

  api.get("/sabados", async (peticion) => {
    requiereSesion(peticion);
    return { sabados: await listarSabados(db) };
  });

  api.post("/sabados", async (peticion) => {
    requiereSesion(peticion);
    const { fecha } = z.object({ fecha: z.string() }).parse(peticion.body);
    const sabado = await obtenerOCrearSabado(db, fecha);
    return detalleSabado(sabado.id);
  });

  api.get("/sabados/:id", async (peticion) => {
    requiereSesion(peticion);
    return detalleSabado(idSchema.parse(peticion.params).id);
  });

  api.post("/sabados/:id/local", async (peticion) => {
    const actor = actorDe(peticion);
    const { esLocal } = z.object({ esLocal: z.boolean() }).parse(peticion.body);
    await marcarLocal(db, actor, idSchema.parse(peticion.params).id, esLocal);
    return detalleSabado(idSchema.parse(peticion.params).id);
  });

  // --- Invitados ---------------------------------------------------------------
  api.put("/parametros/precio-invitado", async (peticion) => {
    const actor = actorDe(peticion);
    const { montoCentavos } = z.object({ montoCentavos: montoSchema }).parse(peticion.body);
    await fijarPrecioInvitado(db, actor, montoCentavos);
    return { precioInvitadoCentavos: montoCentavos };
  });

  api.post("/sabados/:id/invitados", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z
      .object({
        medio: z.enum(["EFECTIVO", "TRANSFERENCIA"]),
        nombre: textoOpcional(120),
        camada: textoOpcional(60),
        nota: textoOpcional(200),
      })
      .parse(peticion.body);
    const pago = await cobrarInvitado(db, actor, { sabadoId: idSchema.parse(peticion.params).id, ...datos });
    return respuesta.status(201).send({ pago });
  });

  api.post("/pagos/:id/anular", async (peticion) => {
    const actor = actorDe(peticion);
    const { motivo } = motivoSchema.parse(peticion.body);
    return { pago: await anularPago(db, actor, idSchema.parse(peticion.params).id, motivo) };
  });

  // --- Cocina ------------------------------------------------------------------
  api.post("/sabados/:id/cocina", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z
      .object({
        camada: z.string().trim().min(1, "Falta la camada.").max(60),
        responsableNombre: z.string().trim().min(1, "Falta el responsable.").max(80),
        responsableTelefono: textoOpcional(30),
      })
      .parse(peticion.body);
    const { cocina, token } = await crearCocina(db, actor, { sabadoId: idSchema.parse(peticion.params).id, ...datos });
    return respuesta.status(201).send({ cocina, token });
  });

  api.post("/cocinas/:id/link", async (peticion) => {
    const actor = actorDe(peticion);
    return { token: await regenerarLink(db, actor, idSchema.parse(peticion.params).id) };
  });

  api.get("/cocinas/:id", async (peticion) => {
    requiereSesion(peticion);
    return resumenCocina(db, idSchema.parse(peticion.params).id);
  });

  api.post("/cocinas/:id/adelantos", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z
      .object({ montoCentavos: montoSchema, medio: z.enum(["EFECTIVO", "TRANSFERENCIA"]), nota: textoOpcional(200) })
      .parse(peticion.body);
    const movimiento = await adelantar(db, actor, { cocinaId: idSchema.parse(peticion.params).id, ...datos });
    return respuesta.status(201).send({ movimiento });
  });

  api.post("/cocinas/:id/gastos", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z.object({ proveedor: textoOpcional(120), items: itemsSchema }).parse(peticion.body);
    const gasto = await gastoDeCocina(db, actor, { cocinaId: idSchema.parse(peticion.params).id, origenCarga: "MANUAL", ...datos });
    return respuesta.status(201).send({ gasto });
  });

  api.post("/cocinas/:id/cerrar", async (peticion) => {
    const actor = actorDe(peticion);
    const datos = z
      .object({
        forma: z.enum([
          "SIN_DIFERENCIA",
          "DEVOLUCION_TRANSFERENCIA",
          "DEVOLUCION_EFECTIVO",
          "REINTEGRO_TRANSFERENCIA",
          "REINTEGRO_EFECTIVO",
          "SOBRANTE_NO_DEVUELTO",
          "EXCESO_NO_REINTEGRADO",
        ]),
        motivo: textoOpcional(300),
      })
      .parse(peticion.body);
    const cocina = await cerrarCocina(db, actor, { cocinaId: idSchema.parse(peticion.params).id, ...datos });
    return { cocina };
  });

  api.post("/gastos/:id/anular", async (peticion) => {
    const actor = actorDe(peticion);
    const { motivo } = motivoSchema.parse(peticion.body);
    return { gasto: await anularGasto(db, actor, idSchema.parse(peticion.params).id, motivo) };
  });

  api.get("/sabados/:id/eliminar", async (peticion) => antesDeEliminarSabado(db, actorDe(peticion), idSchema.parse(peticion.params).id));

  api.post("/sabados/:id/eliminar", async (peticion) => {
    await eliminarSabado(db, actorDe(peticion), idSchema.parse(peticion.params).id, eliminarSabadoSchema.parse(peticion.body ?? {}));
    return { ok: true };
  });

  api.put("/gastos/:id", async (peticion) => {
    const nuevo = await editarGasto(db, actorDe(peticion), idSchema.parse(peticion.params).id, (peticion.body ?? {}) as never);
    return { id: nuevo.id };
  });

  api.post("/gastos/:id/eliminar", async (peticion) => {
    const cuerpo = (peticion.body ?? {}) as { plata?: unknown };
    return eliminarGasto(db, actorDe(peticion), idSchema.parse(peticion.params).id, (cuerpo.plata ?? null) as never);
  });

  api.post("/movimientos-cocina/:id/anular", async (peticion) => {
    const actor = actorDe(peticion);
    const { motivo } = motivoSchema.parse(peticion.body);
    return { movimiento: await anularMovimientoCocina(db, actor, idSchema.parse(peticion.params).id, motivo) };
  });

  // --- Página pública del responsable de la camada -------------------------------
  api.get(
    "/publico/cocina/:token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (peticion) => {
      const { token } = z.object({ token: z.string().max(100) }).parse(peticion.params);
      const cocina = await cocinaPorToken(db, token);
      if (!cocina) throw new ErrorHttp(404, "LINK_INVALIDO", "Este link no existe o la cocina ya se cerró.");
      const [sabado] = await db.select().from(sabados).where(eq(sabados.id, cocina.sabadoId)).limit(1);
      const r = await resumenCocina(db, cocina.id);
      const enRevision = (await ticketsDeCocina(db, cocina.id)).filter((t) => t.estado === "REVISAR").length;
      return {
        ticketsEnRevision: enRevision,
        camada: cocina.camada,
        responsable: cocina.responsableNombre,
        fecha: sabado?.fecha,
        recibidoCentavos: r.adelantadoCentavos,
        gastadoCentavos: r.gastadoCentavos,
        saldoCentavos: r.saldoCentavos,
        gastos: r.gastos
          .filter((g) => g.estado === "CONFIRMADO")
          .map((g) => ({
            id: g.id,
            fecha: g.fecha,
            proveedor: g.proveedor,
            totalCentavos: g.totalCentavos,
            items: g.items.map((i) => ({ descripcion: i.descripcion, cantidad: i.cantidad, subtotalCentavos: i.subtotalCentavos })),
          })),
      };
    },
  );
}
