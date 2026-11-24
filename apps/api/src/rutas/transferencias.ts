import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BaseDeDatos } from "../db/cliente.js";
import {
  asignarAJugador,
  cantidadParaRevisar,
  ESPERA_ENTRE_LECTURAS_MS,
  estadoLectura,
  fijarFechaCorte,
  leerCuenta,
  marcarNoEsDelPlantel,
  marcarYaRegistrada,
  registrarOtroIngreso,
  transferenciasParaRevisar,
  ultimasTransferencias,
  type BuscarEntradas,
} from "../verificacion/transferencias.js";
import { actorDe, ErrorHttp, requiereSesion } from "./comun.js";

const mpIdSchema = z.object({ id: z.string().regex(/^\d{4,30}$/, "El número de operación no es válido.") });
const notaSchema = z.object({ nota: z.string().max(300) });

function mismaClave(recibida: unknown, esperada: string): boolean {
  if (typeof recibida !== "string") return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function rutasTransferencias(
  api: FastifyInstance,
  db: BaseDeDatos,
  buscar: BuscarEntradas | null,
  claveLectura: string | undefined,
  conectada: boolean,
  despacharEmails: () => Promise<unknown>,
) {
  /** Lo llama un servicio externo gratis cada 10 minutos (con la clave secreta en el encabezado). */
  api.post("/cuenta/leer", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (peticion) => {
    if (!claveLectura || !mismaClave(peticion.headers["x-clave-lectura"], claveLectura)) {
      throw new ErrorHttp(401, "CLAVE_INCORRECTA", "Falta la clave de lectura o es incorrecta.");
    }
    const r = await leerCuenta(db, buscar, { siNoSeLeyoHace: 60_000 });
    // De paso se mandan los emails pendientes (y se reintentan los que fallaron).
    await despacharEmails();
    return r;
  });

  /** Cuando alguien abre la app: lee si hace más de 2 minutos que no se lee. */
  api.post("/cuenta/leer-ahora", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (peticion) => {
    requiereSesion(peticion);
    const r = await leerCuenta(db, buscar, { siNoSeLeyoHace: ESPERA_ENTRE_LECTURAS_MS });
    void despacharEmails();
    return r;
  });

  api.get("/cuenta/estado", async (peticion) => {
    requiereSesion(peticion);
    return { ...(await estadoLectura(db)), conectada, paraRevisar: await cantidadParaRevisar(db) };
  });

  api.put("/cuenta/fecha-corte", async (peticion) => {
    const { fecha } = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.") }).parse(peticion.body);
    await fijarFechaCorte(db, actorDe(peticion), fecha);
    return { fechaCorte: fecha };
  });

  api.get("/transferencias/revisar", async (peticion) => {
    requiereSesion(peticion);
    return { transferencias: await transferenciasParaRevisar(db) };
  });

  api.get("/transferencias", async (peticion) => {
    requiereSesion(peticion);
    return { transferencias: await ultimasTransferencias(db) };
  });

  api.post("/transferencias/:id/jugador", async (peticion) => {
    const { jugadorId, cuotas } = z
      .object({ jugadorId: z.string().uuid(), cuotas: z.array(z.string().uuid()).min(1, "Elegí qué cuotas paga.").max(24) })
      .parse(peticion.body);
    return { pago: await asignarAJugador(db, actorDe(peticion), mpIdSchema.parse(peticion.params).id, jugadorId, cuotas) };
  });

  api.post("/transferencias/:id/ya-registrada", async (peticion) => {
    const { nota } = notaSchema.parse(peticion.body);
    return { transferencia: await marcarYaRegistrada(db, actorDe(peticion), mpIdSchema.parse(peticion.params).id, nota) };
  });

  api.post("/transferencias/:id/otro-ingreso", async (peticion) => {
    const { nota } = notaSchema.parse(peticion.body);
    return { pago: await registrarOtroIngreso(db, actorDe(peticion), mpIdSchema.parse(peticion.params).id, nota) };
  });

  api.post("/transferencias/:id/no-es-del-plantel", async (peticion) => {
    const { nota } = notaSchema.parse(peticion.body);
    return { transferencia: await marcarNoEsDelPlantel(db, actorDe(peticion), mpIdSchema.parse(peticion.params).id, nota) };
  });
}
