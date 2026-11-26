/**
 * Lápiz y X en todo lo que falta (decisión del dueño, 26/11/2026). Solo el dueño edita y elimina.
 *
 * Regla común: si lo que se elimina movió plata, el dueño elige qué pasó con esa plata:
 * - "DEVUELTA": sale de la caja (se anula el asiento).
 * - "QUEDA": queda en la caja como Otro ingreso, con el nombre que pone el dueño.
 * Editar algo con plata = anular el asiento viejo y registrar uno nuevo con los datos corregidos.
 * Los asientos de caja nunca se borran, así la caja siempre cierra.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria/auditoria.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { anularAsiento, registrarAsiento, type ActorAdmin } from "../caja/libro.js";
import { nombreDelMes, registrarPagoDeCuotas } from "../cuotas/cuotas.js";
import type { BaseDeDatos, Transaccion } from "../db/cliente.js";
import {
  cargos,
  cocinas,
  comprasEntradas,
  cuentasCaja,
  entradas,
  fiestas,
  movimientosCaja,
  movimientosCocina,
  notificaciones,
  pagos,
  periodosCuota,
  tandas,
  tiposEntrada,
  transferenciasRecibidas,
} from "../db/esquema.js";
import { ErrorNegocio, noExiste, soloDueno } from "../errores.js";
import { normalizarDni } from "@3t/shared";

const nombre = z.string().trim().min(3, "Poné un nombre (por ejemplo, «Prueba de la app»).").max(120);
export const plataSchema = z
  .discriminatedUnion("destino", [z.object({ destino: z.literal("DEVUELTA") }), z.object({ destino: z.literal("QUEDA"), concepto: nombre })])
  .optional();
export type Plata = z.infer<typeof plataSchema>;

const exigirDueno = (actor: ActorAdmin, que: string) => {
  if (actor.rol !== "DUENO") throw soloDueno(que);
};

/** Marca en la transacción qué registro se puede borrar (la base lo controla). */
async function permitirBorrar(tx: Transaccion, clave: string) {
  await tx.execute(sql`select set_config('app.eliminando', ${clave}, true)`);
}

/** La cuenta donde entró un pago (la del plantel o el efectivo de un admin). */
export async function cuentaDelPago(tx: Transaccion, asientoId: string) {
  const [fila] = await tx
    .select({ codigo: cuentasCaja.codigo })
    .from(movimientosCaja)
    .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
    .where(and(eq(movimientosCaja.asientoId, asientoId), sql`${movimientosCaja.montoCentavos} > 0`))
    .limit(1);
  if (!fila) throw new Error("No se encontró la cuenta del pago");
  return fila.codigo;
}

type Pago = typeof pagos.$inferSelect;

/** Registra "Otro ingreso" con la plata que queda en la caja. Devuelve el pago nuevo. */
async function otroIngreso(tx: Transaccion, actor: ActorAdmin, base: Pago, cuenta: string, monto: bigint, concepto: string) {
  const asientoId = await registrarAsiento(tx, actor, {
    fecha: base.fecha,
    descripcion: `Otro ingreso: ${concepto}`.slice(0, 200),
    origen: "PAGO",
    lineas: [
      { cuentaCodigo: cuenta, montoCentavos: monto },
      { cuentaCodigo: "INGRESO:OTROS", montoCentavos: -monto },
    ],
  });
  const [nuevo] = await tx
    .insert(pagos)
    .values({ origen: "OTRO", montoCentavos: monto, medio: base.medio, fecha: base.fecha, nota: concepto.slice(0, 300), recibidoPorAdminId: base.recibidoPorAdminId, registradoPorAdminId: actor.adminId, asientoId })
    .returning();
  if (!nuevo) throw new Error("No se pudo registrar el ingreso");
  return nuevo;
}

/** Anula el asiento de un pago y lo marca anulado. */
async function anularElPago(tx: Transaccion, actor: ActorAdmin, pago: Pago, motivo: string) {
  const anulacionAsientoId = await anularAsiento(tx, actor, { asientoId: pago.asientoId, motivo });
  await tx.update(pagos).set({ estado: "ANULADO", anuladoEn: new Date(), anuladoPorAdminId: actor.adminId, motivoAnulacion: motivo, anulacionAsientoId }).where(eq(pagos.id, pago.id));
}

/** La transferencia que había confirmado un pago apunta al pago que lo reemplaza (o queda como devuelta). */
async function moverTransferencia(tx: Transaccion, actor: ActorAdmin, pagoViejo: string, reemplazo: { pagoId: string; resolucion?: "OTRO_INGRESO" } | null, nota: string) {
  if (reemplazo) {
    await tx
      .update(transferenciasRecibidas)
      .set(reemplazo.resolucion ? { pagoId: reemplazo.pagoId, resolucion: reemplazo.resolucion, estado: "RESUELTA", resueltoPorAdminId: actor.adminId, resueltoEn: new Date() } : { pagoId: reemplazo.pagoId })
      .where(eq(transferenciasRecibidas.pagoId, pagoViejo));
  } else {
    await tx
      .update(transferenciasRecibidas)
      .set({ estado: "RESUELTA", resolucion: "DEVUELTA", pagoId: null, nota: nota.slice(0, 300), resueltoPorAdminId: actor.adminId, resueltoEn: new Date() })
      .where(eq(transferenciasRecibidas.pagoId, pagoViejo));
  }
}

// ---------------------------------------------------------------------------
// Cobros a invitados
// ---------------------------------------------------------------------------

async function cobroParaCambiar(tx: Transaccion, pagoId: string) {
  const [pago] = await tx.select().from(pagos).where(eq(pagos.id, pagoId)).for("update");
  if (!pago || pago.origen !== "INVITADO") throw noExiste("El cobro");
  return pago;
}

export async function eliminarCobro(db: BaseDeDatos, actor: ActorAdmin, pagoId: string, plata: Plata) {
  exigirDueno(actor, "eliminar un cobro");
  return db.transaction(async (tx) => {
    const pago = await cobroParaCambiar(tx, pagoId);
    if (pago.estado === "CONFIRMADO") {
      if (!plata) throw new ErrorNegocio(409, "CON_PLATA", "Elegí si devolviste la plata o si queda en la caja.");
      const cuenta = await cuentaDelPago(tx, pago.asientoId);
      await anularElPago(tx, actor, pago, "Cobro eliminado");
      const otro = plata.destino === "QUEDA" ? await otroIngreso(tx, actor, pago, cuenta, pago.montoCentavos, plata.concepto) : null;
      await moverTransferencia(tx, actor, pago.id, otro ? { pagoId: otro.id, resolucion: "OTRO_INGRESO" } : null, "Devuelta al eliminar el cobro");
    }
    await permitirBorrar(tx, `pagos:${pago.id}`);
    await tx.delete(pagos).where(eq(pagos.id, pago.id));
    await registrarAuditoria(tx, actor, { accion: "COBRO_ELIMINADO", entidad: "pago", entidadId: pago.id, antes: pago, despues: plata ?? null });
  });
}

export const editarCobroSchema = z.object({
  montoCentavos: z.coerce.bigint().positive("El monto tiene que ser mayor a cero."),
  medio: z.enum(["EFECTIVO", "TRANSFERENCIA"]),
  nombre: z.string().trim().max(120).optional(),
  camada: z.string().trim().max(120).optional(),
  nota: z.string().trim().max(300).optional(),
});

export async function editarCobro(db: BaseDeDatos, actor: ActorAdmin, pagoId: string, pedido: z.input<typeof editarCobroSchema>) {
  exigirDueno(actor, "editar un cobro");
  const datos = editarCobroSchema.parse(pedido);
  return db.transaction(async (tx) => {
    const pago = await cobroParaCambiar(tx, pagoId);
    if (pago.estado !== "CONFIRMADO") throw new ErrorNegocio(409, "ANULADO", "Ese cobro está anulado: no se edita.");
    await anularElPago(tx, actor, pago, "Cobro editado");
    const recibidoPor = datos.medio === "EFECTIVO" ? (pago.recibidoPorAdminId ?? actor.adminId) : null;
    const asientoId = await registrarAsiento(tx, actor, {
      fecha: pago.fecha,
      descripcion: `Invitado${datos.nombre ? ` ${datos.nombre}` : ""}`.slice(0, 200),
      origen: "PAGO",
      lineas: [
        { cuentaCodigo: datos.medio === "EFECTIVO" ? codigoEfectivo(recibidoPor ?? "") : "CUENTA", montoCentavos: datos.montoCentavos },
        { cuentaCodigo: "INGRESO:INVITADOS", montoCentavos: -datos.montoCentavos },
      ],
    });
    const [nuevo] = await tx
      .insert(pagos)
      .values({
        origen: "INVITADO",
        montoCentavos: datos.montoCentavos,
        medio: datos.medio,
        fecha: pago.fecha,
        sabadoId: pago.sabadoId,
        nombrePagador: datos.nombre || null,
        camadaPagador: datos.camada || null,
        nota: datos.nota || null,
        recibidoPorAdminId: recibidoPor,
        registradoPorAdminId: pago.registradoPorAdminId,
        asientoId,
      })
      .returning();
    if (!nuevo) throw new Error("No se pudo guardar el cobro");
    await moverTransferencia(tx, actor, pago.id, { pagoId: nuevo.id }, "");
    await permitirBorrar(tx, `pagos:${pago.id}`);
    await tx.delete(pagos).where(eq(pagos.id, pago.id));
    await registrarAuditoria(tx, actor, { accion: "COBRO_EDITADO", entidad: "pago", entidadId: nuevo.id, antes: pago, despues: nuevo });
    return nuevo;
  });
}

// ---------------------------------------------------------------------------
// Cocina: datos y movimientos (mientras esté abierta)
// ---------------------------------------------------------------------------

export const editarCocinaSchema = z.object({
  camada: z.string().trim().min(1).max(60),
  responsableNombre: z.string().trim().min(2).max(80),
  responsableTelefono: z.string().trim().max(30).optional(),
});

export async function editarCocina(db: BaseDeDatos, actor: ActorAdmin, cocinaId: string, pedido: z.input<typeof editarCocinaSchema>) {
  exigirDueno(actor, "editar la cocina");
  const datos = editarCocinaSchema.parse(pedido);
  return db.transaction(async (tx) => {
    const [cocina] = await tx.select().from(cocinas).where(eq(cocinas.id, cocinaId)).for("update");
    if (!cocina) throw noExiste("La cocina");
    await tx.update(cocinas).set({ camada: datos.camada, responsableNombre: datos.responsableNombre, responsableTelefono: datos.responsableTelefono || null }).where(eq(cocinas.id, cocinaId));
    await registrarAuditoria(tx, actor, {
      accion: "COCINA_EDITADA",
      entidad: "cocina",
      entidadId: cocinaId,
      antes: { camada: cocina.camada, responsableNombre: cocina.responsableNombre },
      despues: { camada: datos.camada, responsableNombre: datos.responsableNombre },
    });
  });
}

async function movimientoParaCambiar(tx: Transaccion, movimientoId: string) {
  const [mov] = await tx.select().from(movimientosCocina).where(eq(movimientosCocina.id, movimientoId)).for("update");
  if (!mov) throw noExiste("El movimiento");
  const [cocina] = await tx.select().from(cocinas).where(eq(cocinas.id, mov.cocinaId)).for("update");
  if (cocina?.estado === "CERRADA") throw new ErrorNegocio(409, "COCINA_CERRADA", "La cocina ya se cerró y rindió: para cambiarla hay que eliminar el sábado.");
  return mov;
}

/** Eliminar una plata pasada o devuelta a la camada: es como si no se hubiera hecho (vuelve a donde estaba). */
export async function eliminarMovimientoCocina(db: BaseDeDatos, actor: ActorAdmin, movimientoId: string) {
  exigirDueno(actor, "eliminar un movimiento de la cocina");
  return db.transaction(async (tx) => {
    const mov = await movimientoParaCambiar(tx, movimientoId);
    if (mov.estado === "CONFIRMADO") await anularAsiento(tx, actor, { asientoId: mov.asientoId, motivo: "Movimiento eliminado" });
    await permitirBorrar(tx, `movimientos_cocina:${mov.id}`);
    await tx.delete(movimientosCocina).where(eq(movimientosCocina.id, mov.id));
    await registrarAuditoria(tx, actor, { accion: "MOVIMIENTO_COCINA_ELIMINADO", entidad: "movimiento_cocina", entidadId: mov.id, antes: mov });
  });
}

/** Corregir el monto de un movimiento de la cocina: se anula y se registra de nuevo con el monto correcto. */
export async function editarMovimientoCocina(db: BaseDeDatos, actor: ActorAdmin, movimientoId: string, montoCentavos: bigint) {
  exigirDueno(actor, "editar un movimiento de la cocina");
  if (montoCentavos <= 0n) throw new ErrorNegocio(400, "MONTO_INVALIDO", "El monto tiene que ser mayor a cero.");
  return db.transaction(async (tx) => {
    const mov = await movimientoParaCambiar(tx, movimientoId);
    if (mov.estado !== "CONFIRMADO") throw new ErrorNegocio(409, "ANULADO", "Ese movimiento está anulado: no se edita.");
    const lineas = await tx
      .select({ codigo: cuentasCaja.codigo, monto: movimientosCaja.montoCentavos })
      .from(movimientosCaja)
      .innerJoin(cuentasCaja, eq(cuentasCaja.id, movimientosCaja.cuentaId))
      .where(eq(movimientosCaja.asientoId, mov.asientoId));
    if (lineas.length !== 2) throw new ErrorNegocio(409, "NO_EDITABLE", "Este movimiento no se puede editar: eliminalo y cargalo de nuevo.");
    await anularAsiento(tx, actor, { asientoId: mov.asientoId, motivo: "Movimiento editado" });
    const asientoId = await registrarAsiento(tx, actor, {
      fecha: mov.creadoEn,
      descripcion: `Cocina: ${mov.tipo.toLowerCase()} corregido`,
      origen: mov.tipo === "ADELANTO" ? "ADELANTO" : mov.tipo === "DEVOLUCION" || mov.tipo === "REINTEGRO" ? "RENDICION" : "AJUSTE",
      lineas: lineas.map((l) => ({ cuentaCodigo: l.codigo, montoCentavos: l.monto > 0n ? montoCentavos : -montoCentavos })),
    });
    const [nuevo] = await tx
      .insert(movimientosCocina)
      .values({ cocinaId: mov.cocinaId, tipo: mov.tipo, montoCentavos, medio: mov.medio, nota: mov.nota, registradoPorAdminId: mov.registradoPorAdminId, asientoId })
      .returning();
    await permitirBorrar(tx, `movimientos_cocina:${mov.id}`);
    await tx.delete(movimientosCocina).where(eq(movimientosCocina.id, mov.id));
    await registrarAuditoria(tx, actor, { accion: "MOVIMIENTO_COCINA_EDITADO", entidad: "movimiento_cocina", entidadId: nuevo?.id ?? "", antes: mov, despues: nuevo });
    return nuevo;
  });
}

// ---------------------------------------------------------------------------
// Cuotas
// ---------------------------------------------------------------------------

/**
 * Saca de sus pagos las cuotas que se van a borrar. Si un pago cubría también otras cuotas, esas siguen pagadas
 * (el pago se vuelve a registrar por esa parte). La parte que se va: devuelta o queda como otro ingreso.
 */
export async function quitarCuotasDeSusPagos(tx: Transaccion, actor: ActorAdmin, cargoIds: string[], plata: Plata, motivo: string) {
  const delGrupo = cargoIds.length
    ? await tx.select().from(cargos).where(and(inArray(cargos.id, cargoIds), eq(cargos.estado, "PAGADO")))
    : [];
  if (delGrupo.length > 0 && !plata) throw new ErrorNegocio(409, "CON_PLATA", "Ya hay cuotas pagadas: elegí si devolviste la plata o si queda en la caja.");
  const quitar = new Set(cargoIds);
  for (const pagoId of [...new Set(delGrupo.map((c) => c.pagoId as string))]) {
    const [pago] = await tx.select().from(pagos).where(eq(pagos.id, pagoId)).for("update");
    if (!pago || pago.estado !== "CONFIRMADO") continue;
    const cuenta = await cuentaDelPago(tx, pago.asientoId);
    const suyas = await tx
      .select({ cargo: cargos, anio: periodosCuota.anio, mes: periodosCuota.mes })
      .from(cargos)
      .innerJoin(periodosCuota, eq(periodosCuota.id, cargos.periodoId))
      .where(eq(cargos.pagoId, pagoId))
      .orderBy(asc(periodosCuota.anio), asc(periodosCuota.mes));
    const seVa = suyas.filter((s) => quitar.has(s.cargo.id)).reduce((s, x) => s + x.cargo.montoCentavos, 0n);
    const otras = suyas.filter((s) => !quitar.has(s.cargo.id));

    await tx.update(cargos).set({ estado: "PENDIENTE", pagoId: null }).where(eq(cargos.pagoId, pagoId));
    await anularElPago(tx, actor, pago, motivo);

    let nuevoCuotas: string | null = null;
    if (otras.length > 0 && pago.jugadorId) {
      const nuevo = await registrarPagoDeCuotas(tx, actor, {
        jugadorId: pago.jugadorId,
        cuotas: otras.map((o) => ({ ...o.cargo, estado: "PENDIENTE" as const, pagoId: null, anio: o.anio, mes: o.mes })),
        medio: pago.medio === "EFECTIVO" ? "EFECTIVO" : "TRANSFERENCIA",
        fecha: pago.fecha,
        ...(pago.recibidoPorAdminId ? { recibidoPorAdminId: pago.recibidoPorAdminId } : {}),
        ...(pago.nota ? { nota: pago.nota } : {}),
      });
      nuevoCuotas = nuevo.id;
    }
    const otro = plata?.destino === "QUEDA" && seVa > 0n ? await otroIngreso(tx, actor, pago, cuenta, seVa, plata.concepto) : null;
    await moverTransferencia(tx, actor, pagoId, nuevoCuotas ? { pagoId: nuevoCuotas } : otro ? { pagoId: otro.id, resolucion: "OTRO_INGRESO" } : null, `Devuelta: ${motivo}`);
  }
  return delGrupo.length;
}

export async function eliminarCuota(db: BaseDeDatos, actor: ActorAdmin, cargoId: string, plata: Plata) {
  exigirDueno(actor, "eliminar una cuota");
  return db.transaction(async (tx) => {
    const [cargo] = await tx.select({ cargo: cargos, anio: periodosCuota.anio, mes: periodosCuota.mes }).from(cargos).innerJoin(periodosCuota, eq(periodosCuota.id, cargos.periodoId)).where(eq(cargos.id, cargoId)).for("update", { of: cargos });
    if (!cargo) throw noExiste("La cuota");
    await quitarCuotasDeSusPagos(tx, actor, [cargoId], plata, `Se eliminó la cuota de ${nombreDelMes(cargo.anio, cargo.mes)}`);
    await permitirBorrar(tx, `cargos:${cargoId}`);
    await tx.delete(cargos).where(eq(cargos.id, cargoId));
    await registrarAuditoria(tx, actor, { accion: "CUOTA_ELIMINADA", entidad: "cargo", entidadId: cargoId, antes: cargo.cargo, despues: plata ?? null });
  });
}

/** Corregir el monto de una cuota pendiente. */
export async function editarCuota(db: BaseDeDatos, actor: ActorAdmin, cargoId: string, montoCentavos: bigint) {
  exigirDueno(actor, "cambiar el monto de una cuota");
  if (montoCentavos <= 0n) throw new ErrorNegocio(400, "MONTO_INVALIDO", "El monto tiene que ser mayor a cero.");
  return db.transaction(async (tx) => {
    const [cargo] = await tx.select().from(cargos).where(eq(cargos.id, cargoId)).for("update");
    if (!cargo) throw noExiste("La cuota");
    if (cargo.estado !== "PENDIENTE") throw new ErrorNegocio(409, "NO_PENDIENTE", "Solo se corrige el monto de una cuota que se debe. Si ya se pagó, eliminala o anulá el pago.");
    await tx.update(cargos).set({ montoCentavos }).where(eq(cargos.id, cargoId));
    await registrarAuditoria(tx, actor, { accion: "CUOTA_EDITADA", entidad: "cargo", entidadId: cargoId, antes: { montoCentavos: cargo.montoCentavos.toString() }, despues: { montoCentavos: montoCentavos.toString() } });
  });
}

// ---------------------------------------------------------------------------
// Compras y entradas de fiestas
// ---------------------------------------------------------------------------

/** Eliminar una compra con todas sus entradas. Si estaba pagada, el dueño elige qué pasó con la plata. */
export async function eliminarCompra(db: BaseDeDatos, actor: ActorAdmin, compraId: string, plata: Plata) {
  exigirDueno(actor, "eliminar una compra");
  return db.transaction(async (tx) => {
    const [compra] = await tx.select().from(comprasEntradas).where(eq(comprasEntradas.id, compraId)).for("update");
    if (!compra) throw noExiste("La compra");
    const [pago] = compra.pagoId ? await tx.select().from(pagos).where(eq(pagos.id, compra.pagoId)).for("update") : [];
    if (pago?.estado === "CONFIRMADO") {
      if (!plata) throw new ErrorNegocio(409, "CON_PLATA", "La compra está pagada: elegí si devolviste la plata o si queda en la caja.");
      const cuenta = await cuentaDelPago(tx, pago.asientoId);
      await anularElPago(tx, actor, pago, "Compra de entradas eliminada");
      const otro = plata.destino === "QUEDA" ? await otroIngreso(tx, actor, pago, cuenta, pago.montoCentavos, plata.concepto) : null;
      await moverTransferencia(tx, actor, pago.id, otro ? { pagoId: otro.id, resolucion: "OTRO_INGRESO" } : null, "Devuelta al eliminar la compra");
    }
    const [cantidad] = await tx.select({ n: sql<number>`count(*)::int` }).from(entradas).where(eq(entradas.compraId, compraId));
    await permitirBorrar(tx, `compras_entradas:${compraId}`);
    await tx.delete(entradas).where(eq(entradas.compraId, compraId));
    await tx.delete(notificaciones).where(eq(notificaciones.compraId, compraId));
    await tx.delete(comprasEntradas).where(eq(comprasEntradas.id, compraId));
    await registrarAuditoria(tx, actor, {
      accion: "COMPRA_ELIMINADA",
      entidad: "compras_entradas",
      entidadId: compraId,
      antes: { fiestaId: compra.fiestaId, estado: compra.estado, totalCentavos: compra.totalCentavos.toString(), entradas: cantidad?.n ?? 0 },
      despues: plata ?? null,
    });
  });
}

export const editarEntradaSchema = z.object({
  nombre: z.string().trim().min(3, "Poné nombre y apellido.").max(80),
  dni: z.string().max(20),
});

export async function editarEntrada(db: BaseDeDatos, actor: ActorAdmin, entradaId: string, pedido: z.input<typeof editarEntradaSchema>) {
  exigirDueno(actor, "editar una entrada");
  const datos = editarEntradaSchema.parse(pedido);
  const dni = normalizarDni(datos.dni);
  if (!dni) throw new ErrorNegocio(400, "DNI_INVALIDO", "El DNI no es válido.");
  return db.transaction(async (tx) => {
    const [entrada] = await tx.select().from(entradas).where(eq(entradas.id, entradaId)).for("update");
    if (!entrada) throw noExiste("La entrada");
    const [repetida] = await tx.select({ id: entradas.id }).from(entradas).where(and(eq(entradas.fiestaId, entrada.fiestaId), eq(entradas.dni, dni), sql`${entradas.id} <> ${entradaId}`, sql`${entradas.estado} <> 'ANULADA'`)).limit(1);
    if (repetida) throw new ErrorNegocio(409, "DNI_REPETIDO", "Ya hay otra entrada con ese DNI en esta fiesta.");
    await tx.execute(sql`select set_config('app.editando', ${`entradas:${entradaId}`}, true)`);
    await tx.update(entradas).set({ nombre: datos.nombre, dni }).where(eq(entradas.id, entradaId));
    await tx.execute(sql`select set_config('app.editando', '', true)`);
    await registrarAuditoria(tx, actor, { accion: "ENTRADA_EDITADA", entidad: "entradas", entidadId: entradaId, antes: { nombreCambia: entrada.nombre !== datos.nombre, dniCambia: entrada.dni !== dni } });
  });
}

// ---------------------------------------------------------------------------
// Tandas
// ---------------------------------------------------------------------------

/** Editar una tanda que no terminó: precio y hasta cuándo vale (por dentro, se quita y se agrega). */
export async function editarTanda(db: BaseDeDatos, actor: ActorAdmin, tandaId: string, datos: { precioCentavos: bigint; hasta: Date }, ahora = new Date()) {
  exigirDueno(actor, "cambiar los precios");
  if (datos.precioCentavos <= 0n) throw new ErrorNegocio(400, "MONTO_INVALIDO", "El precio tiene que ser mayor a cero.");
  return db.transaction(async (tx) => {
    const [tanda] = await tx.select().from(tandas).where(eq(tandas.id, tandaId)).for("update");
    if (!tanda) throw noExiste("La tanda");
    if (tanda.hasta <= ahora) throw new ErrorNegocio(409, "TANDA_TERMINADA", "Esa tanda ya terminó: queda registrada.");
    const [fila] = await tx.select({ fecha: fiestas.fechaHora }).from(tiposEntrada).innerJoin(fiestas, eq(fiestas.id, tiposEntrada.fiestaId)).where(eq(tiposEntrada.id, tanda.tipoId));
    if (datos.hasta <= ahora) throw new ErrorNegocio(400, "TANDA_PASADA", "La tanda tiene que terminar más adelante.");
    if (fila && datos.hasta >= fila.fecha) throw new ErrorNegocio(400, "TANDA_DESPUES_DE_LA_FIESTA", "La tanda tiene que terminar antes de la fiesta.");
    await tx.delete(tandas).where(eq(tandas.id, tandaId));
    const [repetida] = await tx.select().from(tandas).where(and(eq(tandas.tipoId, tanda.tipoId), eq(tandas.hasta, datos.hasta))).limit(1);
    if (repetida) throw new ErrorNegocio(409, "TANDA_REPETIDA", "Ya hay una tanda que termina en ese momento.");
    const [nueva] = await tx.insert(tandas).values({ tipoId: tanda.tipoId, precioCentavos: datos.precioCentavos, hasta: datos.hasta, creadaPorAdminId: actor.adminId }).returning();
    await registrarAuditoria(tx, actor, {
      accion: "TANDA_EDITADA",
      entidad: "tandas",
      entidadId: nueva?.id ?? "",
      antes: { precioCentavos: tanda.precioCentavos.toString(), hasta: tanda.hasta.toISOString() },
      despues: { precioCentavos: datos.precioCentavos.toString(), hasta: datos.hasta.toISOString() },
    });
    return nueva;
  });
}
