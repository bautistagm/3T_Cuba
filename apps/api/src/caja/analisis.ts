/**
 * Análisis de la plata: en qué se gasta, cuándo y por qué.
 * Los números salen de los gastos y cobros confirmados (los anulados no cuentan).
 */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Ejecutor } from "../db/cliente.js";
import { cocinas, gastoItems, gastos, movimientosCocina, pagos, sabados } from "../db/esquema.js";
import { ErrorNegocio } from "../errores.js";
import { CATEGORIAS, type Categoria } from "../gastos/gastos.js";
import { REGLAS_ASISTENTE, type AsistenteIa } from "../ia/asistente.js";

const ZONA = "America/Argentina/Buenos_Aires";

/** "AAAA-MM" del mes actual en Argentina y de los N anteriores (del más viejo al más nuevo). */
export function ultimosMeses(cantidad: number, ahora = new Date()): string[] {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" }).formatToParts(ahora);
  let anio = Number(partes.find((p) => p.type === "year")?.value);
  let mes = Number(partes.find((p) => p.type === "month")?.value);
  const lista: string[] = [];
  for (let i = 0; i < cantidad; i++) {
    lista.unshift(`${anio}-${String(mes).padStart(2, "0")}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      anio -= 1;
    }
  }
  return lista;
}

/** Primer instante del mes "AAAA-MM" en Argentina (UTC-3). */
const inicioDeMes = (mes: string) => new Date(`${mes}-01T00:00:00-03:00`);
const mesSiguiente = (mes: string) => {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};
const mesDe = sql`to_char(${gastos.fecha} AT TIME ZONE ${ZONA}, 'YYYY-MM')`;

export interface MesDeGastos {
  mes: string;
  totalCentavos: bigint;
  porCategoria: Record<Categoria, bigint>;
}

export async function gastosPorMes(db: Ejecutor, meses = 12): Promise<MesDeGastos[]> {
  const lista = ultimosMeses(meses);
  const desde = inicioDeMes(lista[0] ?? "2000-01");
  const filas = await db
    .select({
      mes: sql<string>`${mesDe}`,
      categoria: gastoItems.categoria,
      total: sql<string>`sum(${gastoItems.subtotalCentavos})::text`,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(and(eq(gastos.estado, "CONFIRMADO"), gte(gastos.fecha, desde)))
    .groupBy(sql`1`, gastoItems.categoria);
  return lista.map((mes) => {
    const porCategoria = Object.fromEntries(CATEGORIAS.map((c) => [c, 0n])) as Record<Categoria, bigint>;
    for (const f of filas.filter((f) => f.mes === mes)) porCategoria[f.categoria] = BigInt(f.total);
    return { mes, porCategoria, totalCentavos: Object.values(porCategoria).reduce((t, v) => t + v, 0n) };
  });
}

export async function ingresosPorMes(db: Ejecutor, meses = 12) {
  const lista = ultimosMeses(meses);
  const desde = inicioDeMes(lista[0] ?? "2000-01");
  const filas = await db
    .select({
      mes: sql<string>`to_char(${pagos.fecha} AT TIME ZONE ${ZONA}, 'YYYY-MM')`,
      origen: pagos.origen,
      total: sql<string>`sum(${pagos.montoCentavos})::text`,
    })
    .from(pagos)
    .where(and(eq(pagos.estado, "CONFIRMADO"), gte(pagos.fecha, desde)))
    .groupBy(sql`1`, pagos.origen);
  return lista.map((mes) => {
    const porOrigen: Record<string, bigint> = {};
    for (const f of filas.filter((f) => f.mes === mes)) porOrigen[f.origen] = BigInt(f.total);
    return { mes, porOrigen, totalCentavos: Object.values(porOrigen).reduce((t, v) => t + v, 0n) };
  });
}

/** En qué productos se va la plata (por nombre parecido), en los últimos meses. */
export async function productosQueMasGastan(db: Ejecutor, meses = 6, limite = 10) {
  const desde = inicioDeMes(ultimosMeses(meses)[0] ?? "2000-01");
  const nombre = sql<string>`initcap(lower(trim(${gastoItems.descripcion})))`;
  const filas = await db
    .select({
      producto: nombre,
      categoria: sql<Categoria>`mode() within group (order by ${gastoItems.categoria})`,
      total: sql<string>`sum(${gastoItems.subtotalCentavos})::text`,
      veces: sql<number>`count(*)::int`,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(and(eq(gastos.estado, "CONFIRMADO"), gte(gastos.fecha, desde)))
    .groupBy(nombre)
    .orderBy(desc(sql`sum(${gastoItems.subtotalCentavos})`))
    .limit(limite);
  return filas.map((f) => ({ producto: f.producto, categoria: f.categoria, totalCentavos: BigInt(f.total), veces: f.veces }));
}

/** Los datos de un mes y los meses anteriores, para que la IA (o la app) explique por qué se gastó lo que se gastó. */
export async function datosDelMes(db: Ejecutor, mes: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErrorNegocio(400, "MES_INVALIDO", "El mes no es válido.");
  const desde = inicioDeMes(mes);
  const hasta = inicioDeMes(mesSiguiente(mes));
  const delMes = await db
    .select({ id: gastos.id, fecha: gastos.fecha, proveedor: gastos.proveedor, total: gastos.totalCentavos, cocinaId: gastos.cocinaId })
    .from(gastos)
    .where(and(eq(gastos.estado, "CONFIRMADO"), gte(gastos.fecha, desde), lt(gastos.fecha, hasta)));
  const productos = await db
    .select({
      producto: sql<string>`initcap(lower(trim(${gastoItems.descripcion})))`,
      total: sql<string>`sum(${gastoItems.subtotalCentavos})::text`,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(and(eq(gastos.estado, "CONFIRMADO"), gte(gastos.fecha, desde), lt(gastos.fecha, hasta)))
    .groupBy(sql`1`)
    .orderBy(desc(sql`sum(${gastoItems.subtotalCentavos})`))
    .limit(8);
  const sabadosDelMes = await db
    .select({ fecha: sabados.fecha, esLocal: sabados.esLocal, camada: cocinas.camada })
    .from(sabados)
    .leftJoin(cocinas, eq(cocinas.sabadoId, sabados.id))
    .where(and(gte(sabados.fecha, mes + "-01"), lt(sabados.fecha, mesSiguiente(mes) + "-01")));

  const historial = (await gastosPorMes(db, 12)).filter((m) => m.mes <= mes).slice(-4);
  const actual = historial.at(-1);
  const anteriores = historial.slice(0, -1).filter((m) => m.totalCentavos > 0n);
  const promedioAnterior =
    anteriores.length > 0 ? anteriores.reduce((t, m) => t + m.totalCentavos, 0n) / BigInt(anteriores.length) : null;

  return {
    mes,
    totalCentavos: actual?.totalCentavos ?? 0n,
    porCategoria: actual?.porCategoria ?? null,
    promedioMesesAnterioresCentavos: promedioAnterior,
    mesesAnteriores: anteriores.map((m) => ({ mes: m.mes, totalCentavos: m.totalCentavos, porCategoria: m.porCategoria })),
    cantidadDeCompras: delMes.length,
    comprasDeCocina: delMes.filter((g) => g.cocinaId).length,
    productosPrincipales: productos.map((p) => ({ producto: p.producto, totalCentavos: BigInt(p.total) })),
    sabados: sabadosDelMes.map((s) => ({ fecha: s.fecha, deLocal: s.esLocal, cocinaCamada: s.camada })),
  };
}

const aTexto = (valor: unknown) =>
  JSON.parse(JSON.stringify(valor, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v))) as unknown;

/** Explicación corta de por qué se gastó lo que se gastó en un mes. */
export async function explicarMes(db: Ejecutor, asistente: AsistenteIa, mes: string): Promise<string> {
  const datos = await datosDelMes(db, mes);
  if (datos.totalCentavos === 0n) return "Ese mes no hay gastos registrados.";
  return asistente(
    `${REGLAS_ASISTENTE}\nExplicá en 2 o 3 oraciones por qué ese mes se gastó lo que se gastó: comparalo con el promedio de los meses anteriores, decí qué categoría y qué productos pesaron más y si hubo sábados de local con cocina.`,
    aTexto(datos),
    `¿Por qué en ${mes} se gastó eso?`,
  );
}

/** Responde una pregunta sobre la plata con un resumen de los datos (sin datos personales). */
export async function preguntarSobreLaPlata(db: Ejecutor, asistente: AsistenteIa, pregunta: string): Promise<string> {
  const texto = pregunta.trim();
  if (texto.length < 5) throw new ErrorNegocio(400, "PREGUNTA_CORTA", "Escribí una pregunta un poco más larga.");
  if (texto.length > 300) throw new ErrorNegocio(400, "PREGUNTA_LARGA", "La pregunta es muy larga (máximo 300 caracteres).");
  const [porMes, ingresos, productos, cocinasRecientes] = await Promise.all([
    gastosPorMes(db, 12),
    ingresosPorMes(db, 12),
    productosQueMasGastan(db, 12, 20),
    db
      .select({
        fecha: sabados.fecha,
        camada: cocinas.camada,
        estado: cocinas.estado,
        recibido: sql<string>`coalesce((select sum(${movimientosCocina.montoCentavos}) from ${movimientosCocina} where ${movimientosCocina.cocinaId} = ${cocinas.id} and ${movimientosCocina.tipo} = 'ADELANTO' and ${movimientosCocina.estado} = 'CONFIRMADO'), 0)::text`,
        gastado: sql<string>`coalesce((select sum(${gastos.totalCentavos}) from ${gastos} where ${gastos.cocinaId} = ${cocinas.id} and ${gastos.estado} = 'CONFIRMADO'), 0)::text`,
      })
      .from(cocinas)
      .innerJoin(sabados, eq(sabados.id, cocinas.sabadoId))
      .orderBy(desc(sabados.fecha))
      .limit(20),
  ]);
  return asistente(
    REGLAS_ASISTENTE,
    aTexto({
      gastosPorMesYCategoria: porMes,
      ingresosPorMesYOrigen: ingresos,
      productosQueMasGastan12Meses: productos,
      cocinasDeCamadas: cocinasRecientes,
    }),
    texto,
  );
}
