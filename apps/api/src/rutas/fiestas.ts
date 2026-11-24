import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BaseDeDatos } from "../db/cliente.js";
import {
  anularCompraPendiente,
  cambiarEstadoVenta,
  compraSchema,
  comprasPendientesPorMonto,
  crearCompra,
  crearFiesta,
  detalleFiesta,
  estadoDeCompra,
  fiestaParaComprar,
  listaEnCsv,
  listarFiestas,
  nuevaFiestaSchema,
  nuevoLinkDePuerta,
} from "../fiestas/fiestas.js";
import { asignarACompra, leerCuenta, type BuscarEntradas } from "../verificacion/transferencias.js";
import { transferenciasRecibidas } from "../db/esquema.js";
import { eq } from "drizzle-orm";
import { actorDe, idSchema, requiereSesion } from "./comun.js";

const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/, "El link no es válido.") });
const codigoSchema = z.object({ codigo: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/, "El código no es válido.") });
const mpIdSchema = z.object({ id: z.string().regex(/^\d{4,30}$/, "El número de operación no es válido.") });

export function rutasFiestas(api: FastifyInstance, db: BaseDeDatos, buscar: BuscarEntradas | null) {
  // --- Administración -------------------------------------------------------
  api.get("/fiestas", async (peticion) => {
    requiereSesion(peticion);
    return { fiestas: await listarFiestas(db) };
  });

  api.post("/fiestas", async (peticion, respuesta) => {
    const fiesta = await crearFiesta(db, actorDe(peticion), nuevaFiestaSchema.parse(peticion.body));
    return respuesta.status(201).send({ fiesta: { id: fiesta.id } });
  });

  api.get("/fiestas/:id", async (peticion) => {
    return detalleFiesta(db, idSchema.parse(peticion.params).id, actorDe(peticion));
  });

  api.get("/fiestas/:id/lista.csv", async (peticion, respuesta) => {
    const detalle = await detalleFiesta(db, idSchema.parse(peticion.params).id, actorDe(peticion));
    const nombre = detalle.fiesta.nombre.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || "fiesta";
    return respuesta
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="lista-${nombre}.csv"`)
      .send(`\uFEFF${listaEnCsv(detalle)}`);
  });

  api.post("/fiestas/:id/venta", async (peticion) => {
    const { abierta } = z.object({ abierta: z.boolean() }).parse(peticion.body);
    const f = await cambiarEstadoVenta(db, actorDe(peticion), idSchema.parse(peticion.params).id, abierta);
    return { estado: f.estado };
  });

  api.post("/fiestas/:id/link-puerta", async (peticion) => {
    const f = await nuevoLinkDePuerta(db, actorDe(peticion), idSchema.parse(peticion.params).id);
    return { tokenPuerta: f.tokenPuerta };
  });

  api.post("/compras-entradas/:id/anular", async (peticion) => {
    await anularCompraPendiente(db, actorDe(peticion), idSchema.parse(peticion.params).id);
    return { ok: true };
  });

  // Desde "Revisar": compras pendientes por el mismo total que la transferencia, y asignarla.
  api.get("/transferencias/:id/compras", async (peticion) => {
    requiereSesion(peticion);
    const [t] = await db.select().from(transferenciasRecibidas).where(eq(transferenciasRecibidas.mpPagoId, mpIdSchema.parse(peticion.params).id)).limit(1);
    return { compras: t ? await comprasPendientesPorMonto(db, t.montoCentavos) : [] };
  });

  api.post("/transferencias/:id/compra", async (peticion) => {
    const { compraId } = z.object({ compraId: z.string().uuid() }).parse(peticion.body);
    return { pago: await asignarACompra(db, actorDe(peticion), mpIdSchema.parse(peticion.params).id, compraId) };
  });

  // --- Público (links que se comparten) -------------------------------------
  api.get("/publico/venta/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (peticion) => {
    return fiestaParaComprar(db, tokenSchema.parse(peticion.params).token);
  });

  api.post("/publico/venta/:token/compras", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (peticion, respuesta) => {
    const compra = await crearCompra(db, tokenSchema.parse(peticion.params).token, compraSchema.parse(peticion.body));
    return respuesta.status(compra.existente ? 200 : 201).send(compra);
  });

  /** Quien compró ve el estado. De paso, si hace más de un minuto que no se lee la cuenta, se lee. */
  api.get("/publico/compras/:codigo", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (peticion) => {
    const { codigo } = codigoSchema.parse(peticion.params);
    const actual = await estadoDeCompra(db, codigo);
    if (actual.estado === "PENDIENTE_PAGO") {
      await leerCuenta(db, buscar, { siNoSeLeyoHace: 60_000 }).catch(() => undefined);
      return estadoDeCompra(db, codigo);
    }
    return actual;
  });
}
