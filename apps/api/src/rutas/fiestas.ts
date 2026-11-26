import type { FastifyInstance } from "fastify";
import { antesDeEliminarFiesta, eliminarFiesta, eliminarFiestaSchema } from "../fiestas/eliminar.js";
import { ingresosSchema, listaDePuerta, registrarIngresos } from "../fiestas/puerta.js";
import { z } from "zod";
import type { BaseDeDatos } from "../db/cliente.js";
import {
  agregarTanda,
  editarFiesta,
  anularCompraPendiente,
  quitarTanda,
  tandaSchema,
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
import { actorDe, ErrorHttp, idSchema, requiereSesion } from "./comun.js";
import { estadoEmailsDeCompras, reenviarEntradas } from "../email/entradas.js";

const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/, "El link no es válido.") });
const codigoSchema = z.object({ codigo: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/, "El código no es válido.") });
const mpIdSchema = z.object({ id: z.string().regex(/^\d{4,30}$/, "El número de operación no es válido.") });

export function rutasFiestas(
  api: FastifyInstance,
  db: BaseDeDatos,
  buscar: BuscarEntradas | null,
  despacharEmails: () => Promise<unknown>,
  emailListo: () => Promise<boolean>,
) {
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
    const detalle = await detalleFiesta(db, idSchema.parse(peticion.params).id, actorDe(peticion));
    const emails = await estadoEmailsDeCompras(db, [...new Set(detalle.entradas.map((e) => e.compraId))]);
    return {
      ...detalle,
      emailConfigurado: await emailListo(),
      emails: Object.fromEntries(emails),
    };
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

  api.put("/fiestas/:id", async (peticion) => {
    await editarFiesta(db, actorDe(peticion), idSchema.parse(peticion.params).id, (peticion.body ?? {}) as never);
    return { ok: true };
  });

  api.get("/fiestas/:id/eliminar", async (peticion) => antesDeEliminarFiesta(db, actorDe(peticion), idSchema.parse(peticion.params).id));

  api.post("/fiestas/:id/eliminar", async (peticion) => {
    const r = await eliminarFiesta(db, actorDe(peticion), idSchema.parse(peticion.params).id, eliminarFiestaSchema.parse(peticion.body ?? {}));
    return { ok: true, pagos: r.pagos, totalCentavos: r.totalCentavos };
  });

  api.post("/tipos-entrada/:id/tandas", async (peticion, respuesta) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
    const tanda = await agregarTanda(db, actorDe(peticion), id, tandaSchema.parse(peticion.body));
    return respuesta.code(201).send({ id: tanda?.id });
  });

  api.post("/tandas/:id/quitar", async (peticion) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
    await quitarTanda(db, actorDe(peticion), id);
    return { ok: true };
  });

  api.post("/fiestas/:id/link-puerta", async (peticion) => {
    const f = await nuevoLinkDePuerta(db, actorDe(peticion), idSchema.parse(peticion.params).id);
    return { tokenPuerta: f.tokenPuerta };
  });

  api.post("/compras-entradas/:id/reenviar", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (peticion) => {
    const actor = actorDe(peticion);
    if (actor.rol !== "DUENO") throw new ErrorHttp(403, "SOLO_DUENO", "Solo el dueño puede reenviar las entradas.");
    const { email } = z.object({ email: z.string().trim().toLowerCase().email("El email no es válido.").max(120).optional() }).parse(peticion.body ?? {});
    const r = await reenviarEntradas(db, idSchema.parse(peticion.params).id, email);
    if (r === null) throw new ErrorHttp(404, "NO_EXISTE", "La compra no existe.");
    if (r === "NO_PAGADA") throw new ErrorHttp(409, "NO_PAGADA", "Esa compra no está pagada.");
    await despacharEmails();
    return { ok: true };
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
    const pago = await asignarACompra(db, actorDe(peticion), mpIdSchema.parse(peticion.params).id, compraId);
    void despacharEmails();
    return { pago };
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
  // --- Puerta (link secreto, sin usuario) ---
  api.get("/publico/puerta/:token", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (peticion) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(peticion.params);
    return listaDePuerta(db, token);
  });

  api.post("/publico/puerta/:token/ingresos", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (peticion) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(peticion.params);
    return registrarIngresos(db, { tipo: "PUBLICO", ip: peticion.ip }, token, ingresosSchema.parse(peticion.body));
  });

  api.get("/publico/compras/:codigo", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (peticion) => {
    const { codigo } = codigoSchema.parse(peticion.params);
    const actual = await estadoDeCompra(db, codigo);
    if (actual.estado === "PENDIENTE_PAGO") {
      await leerCuenta(db, buscar, { siNoSeLeyoHace: 60_000 }).catch(() => undefined);
      void despacharEmails();
      return estadoDeCompra(db, codigo);
    }
    return actual;
  });
}
