import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  confirmarTraspaso,
  controlarCaja,
  cuentaDeOrigen,
  depositarEfectivo,
  efectivoDe,
  gastoGeneral,
  iniciarTraspaso,
  listarMovimientos,
  rechazarOCancelarTraspaso,
  saldosCaja,
  traspasosPendientes,
  ultimoControl,
} from "../caja/operaciones.js";
import type { BaseDeDatos } from "../db/cliente.js";
import { admins } from "../db/esquema.js";
import type { LectorTickets } from "../ia/lectorTickets.js";
import type { AsistenteIa } from "../ia/asistente.js";
import { explicarMes, gastosPorMes, ingresosPorMes, preguntarSobreLaPlata, productosQueMasGastan } from "../caja/analisis.js";
import { subirTicket, ticketsDeCocina } from "../tickets/tickets.js";
import { actorDe, idSchema, montoSchema, requiereSesion, textoOpcional } from "./comun.js";
import { itemsSchema } from "./sabados.js";
import { fotoSchema, LIMITE_CUERPO } from "./tickets.js";

const desdeSchema = z.enum(["CUENTA", "EFECTIVO"]);

export function rutasCaja(api: FastifyInstance, db: BaseDeDatos, lector: LectorTickets, asistente: AsistenteIa) {
  api.get("/caja", async (peticion) => {
    const yo = requiereSesion(peticion);
    const [saldos, control, pendientes, activos, miEfectivo, tickets] = await Promise.all([
      saldosCaja(db),
      ultimoControl(db),
      traspasosPendientes(db, yo.id),
      db.select({ id: admins.id, nombre: admins.nombre }).from(admins).where(eq(admins.activo, true)),
      efectivoDe(db, yo.id),
      ticketsDeCocina(db, null),
    ]);
    const nombres = Object.fromEntries(activos.map((a) => [a.id, a.nombre]));
    return {
      ...saldos,
      miEfectivoCentavos: miEfectivo,
      ultimoControl: control,
      traspasosPendientes: pendientes.map((t) => ({ ...t, deNombre: nombres[t.deAdminId] ?? "?", paraNombre: nombres[t.paraAdminId] ?? "?" })),
      administradores: activos,
      ticketsParaRevisar: tickets.filter((t) => t.estado === "REVISAR"),
    };
  });

  api.get("/caja/movimientos", async (peticion) => {
    requiereSesion(peticion);
    const { antesDe } = z.object({ antesDe: z.coerce.date().optional() }).parse(peticion.query);
    return { movimientos: await listarMovimientos(db, { limite: 50, antesDe }) };
  });

  api.post("/caja/depositos", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z.object({ montoCentavos: montoSchema, nota: textoOpcional(200) }).parse(peticion.body);
    await depositarEfectivo(db, actor, datos);
    return respuesta.status(201).send({ ok: true });
  });

  api.post("/caja/traspasos", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z.object({ paraAdminId: z.string().uuid(), montoCentavos: montoSchema, nota: textoOpcional(200) }).parse(peticion.body);
    return respuesta.status(201).send({ traspaso: await iniciarTraspaso(db, actor, datos) });
  });

  api.post("/caja/traspasos/:id/confirmar", async (peticion) => {
    const actor = actorDe(peticion);
    return { traspaso: await confirmarTraspaso(db, actor, idSchema.parse(peticion.params).id) };
  });

  api.post("/caja/traspasos/:id/rechazar", async (peticion) => {
    const actor = actorDe(peticion);
    return { traspaso: await rechazarOCancelarTraspaso(db, actor, idSchema.parse(peticion.params).id) };
  });

  api.post("/caja/gastos", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z.object({ desde: desdeSchema, proveedor: textoOpcional(120), items: itemsSchema }).parse(peticion.body);
    return respuesta.status(201).send({ gasto: await gastoGeneral(db, actor, datos) });
  });

  api.post("/caja/tickets", { bodyLimit: LIMITE_CUERPO }, async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const { imagenBase64, desde } = fotoSchema.extend({ desde: desdeSchema }).parse(peticion.body);
    const resultado = await subirTicket(db, lector, actor, {
      contenido: Buffer.from(imagenBase64, "base64"),
      destino: { tipo: "CAJA", cuentaOrigenCodigo: cuentaDeOrigen(desde, actor.adminId) },
    });
    return respuesta.status(201).send(resultado);
  });

  api.post("/caja/controles", async (peticion, respuesta) => {
    const actor = actorDe(peticion);
    const datos = z
      .object({
        declaradoCentavos: z.string().regex(/^\d{1,13}$/, "El monto no es válido.").transform((t) => BigInt(t)),
        ajustar: z.boolean(),
        motivo: textoOpcional(300),
      })
      .parse(peticion.body);
    return respuesta.status(201).send({ control: await controlarCaja(db, actor, datos) });
  });

  // --- Análisis ----------------------------------------------------------------
  api.get("/caja/analisis", async (peticion) => {
    requiereSesion(peticion);
    const [gastosMes, ingresosMes, productos] = await Promise.all([gastosPorMes(db, 12), ingresosPorMes(db, 12), productosQueMasGastan(db, 6, 10)]);
    return { gastosPorMes: gastosMes, ingresosPorMes: ingresosMes, productos };
  });

  api.post(
    "/caja/analisis/explicar",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (peticion) => {
      requiereSesion(peticion);
      const { mes } = z.object({ mes: z.string() }).parse(peticion.body);
      return { explicacion: await explicarMes(db, asistente, mes) };
    },
  );

  api.post(
    "/caja/analisis/preguntar",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (peticion) => {
      requiereSesion(peticion);
      const { pregunta } = z.object({ pregunta: z.string().max(400) }).parse(peticion.body);
      return { respuesta: await preguntarSobreLaPlata(db, asistente, pregunta) };
    },
  );
}
