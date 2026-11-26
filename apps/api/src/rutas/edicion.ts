/** Lápiz y X en todo lo suelto (solo el dueño; cada función lo controla). */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BaseDeDatos } from "../db/cliente.js";
import {
  editarCobro,
  editarCocina,
  editarCuota,
  editarEntrada,
  editarMovimientoCocina,
  editarTanda,
  eliminarCobro,
  eliminarCompra,
  eliminarCuota,
  eliminarMovimientoCocina,
  plataSchema,
} from "../edicion/sueltos.js";
import { actorDe, idSchema, montoSchema } from "./comun.js";

const conPlata = z.object({ plata: plataSchema });

export function rutasEdicion(api: FastifyInstance, db: BaseDeDatos) {
  const id = (p: unknown) => idSchema.parse(p).id;

  api.post("/pagos/:id/eliminar", async (peticion) => {
    await eliminarCobro(db, actorDe(peticion), id(peticion.params), conPlata.parse(peticion.body ?? {}).plata);
    return { ok: true };
  });
  api.put("/pagos/:id", async (peticion) => {
    const nuevo = await editarCobro(db, actorDe(peticion), id(peticion.params), (peticion.body ?? {}) as never);
    return { id: nuevo.id };
  });

  api.put("/cocinas/:id/datos", async (peticion) => {
    await editarCocina(db, actorDe(peticion), id(peticion.params), (peticion.body ?? {}) as never);
    return { ok: true };
  });
  api.post("/movimientos-cocina/:id/eliminar", async (peticion) => {
    await eliminarMovimientoCocina(db, actorDe(peticion), id(peticion.params));
    return { ok: true };
  });
  api.put("/movimientos-cocina/:id", async (peticion) => {
    const { montoCentavos } = z.object({ montoCentavos: montoSchema }).parse(peticion.body);
    await editarMovimientoCocina(db, actorDe(peticion), id(peticion.params), montoCentavos);
    return { ok: true };
  });

  api.post("/cuotas/:id/eliminar", async (peticion) => {
    await eliminarCuota(db, actorDe(peticion), id(peticion.params), conPlata.parse(peticion.body ?? {}).plata);
    return { ok: true };
  });
  api.put("/cuotas/:id", async (peticion) => {
    const { montoCentavos } = z.object({ montoCentavos: montoSchema }).parse(peticion.body);
    await editarCuota(db, actorDe(peticion), id(peticion.params), montoCentavos);
    return { ok: true };
  });

  api.post("/compras-entradas/:id/eliminar", async (peticion) => {
    await eliminarCompra(db, actorDe(peticion), id(peticion.params), conPlata.parse(peticion.body ?? {}).plata);
    return { ok: true };
  });
  api.put("/entradas/:id", async (peticion) => {
    await editarEntrada(db, actorDe(peticion), id(peticion.params), (peticion.body ?? {}) as never);
    return { ok: true };
  });

  api.put("/tandas/:id", async (peticion) => {
    const datos = z.object({ precioCentavos: montoSchema, hasta: z.coerce.date() }).parse(peticion.body);
    await editarTanda(db, actorDe(peticion), id(peticion.params), datos);
    return { ok: true };
  });
}
