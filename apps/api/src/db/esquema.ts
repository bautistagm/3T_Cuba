/**
 * Esquema de la base de datos (Etapa 2: base).
 *
 * Nombres en español y en snake_case en la base. Los montos siempre en centavos, BIGINT.
 * Las protecciones que no se pueden expresar acá (no borrar, asientos que sumen cero)
 * están en la migración SQL `0001_protecciones.sql`.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const momento = (nombre?: string) =>
  nombre ? timestamp(nombre, { withTimezone: true }) : timestamp({ withTimezone: true });

const tiempos = {
  creadoEn: momento().notNull().defaultNow(),
  actualizadoEn: momento()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Administradores y sesiones
// ---------------------------------------------------------------------------

export const rolAdmin = pgEnum("rol_admin", ["DUENO", "ADMIN"]);

export const admins = pgTable(
  "admins",
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    email: text().notNull(),
    telefono: text(),
    rol: rolAdmin().notNull(),
    activo: boolean().notNull().default(true),
    hashContrasena: text().notNull(),
    ...tiempos,
  },
  (t) => [
    uniqueIndex("admins_email_unico").on(sql`lower(${t.email})`),
    // Hay un solo dueño.
    uniqueIndex("admins_un_solo_dueno").on(t.rol).where(sql`${t.rol} = 'DUENO'`),
  ],
);

export const sesiones = pgTable(
  "sesiones",
  {
    id: uuid().primaryKey().defaultRandom(),
    adminId: uuid()
      .notNull()
      .references(() => admins.id),
    /** Guardamos solo el hash del token: si alguien lee la base, no puede usar las sesiones. */
    tokenHash: text().notNull().unique(),
    creadaEn: momento().notNull().defaultNow(),
    expiraEn: momento().notNull(),
    revocadaEn: momento(),
    ip: text(),
    navegador: text(),
  },
  (t) => [index("sesiones_admin").on(t.adminId)],
);

// ---------------------------------------------------------------------------
// Auditoría: quién hizo qué, cuándo, y cómo estaba antes y después.
// ---------------------------------------------------------------------------

export const tipoActor = pgEnum("tipo_actor", ["ADMIN", "SISTEMA", "PUBLICO"]);

export const auditoria = pgTable(
  "auditoria",
  {
    id: uuid().primaryKey().defaultRandom(),
    creadoEn: momento().notNull().defaultNow(),
    actorTipo: tipoActor().notNull(),
    actorAdminId: uuid().references(() => admins.id),
    accion: text().notNull(),
    entidad: text().notNull(),
    entidadId: text().notNull(),
    antes: jsonb(),
    despues: jsonb(),
    ip: text(),
  },
  (t) => [
    index("auditoria_entidad").on(t.entidad, t.entidadId),
    index("auditoria_fecha").on(t.creadoEn),
    check(
      "auditoria_actor_admin",
      sql`(${t.actorTipo} = 'ADMIN') = (${t.actorAdminId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Libro de caja (doble partida)
//
// Cada evento de plata es un ASIENTO con dos o más MOVIMIENTOS que suman cero.
// - Cuentas de ACTIVO: dónde está la plata (la cuenta del alias, el efectivo de cada admin).
// - Cuentas de INGRESO y EGRESO: por qué entró o salió (cuotas, invitados, carne, bebidas...).
// Ejemplo, un jugador paga $30.000 en efectivo a Juan:
//   EFECTIVO de Juan  +3.000.000
//   INGRESO Cuotas    -3.000.000      (suma: 0)
// El saldo de una cuenta es la suma de sus movimientos. Nunca se guarda un saldo a mano.
// Nada se modifica ni se borra: un error se corrige con un asiento de anulación.
// ---------------------------------------------------------------------------

export const tipoCuenta = pgEnum("tipo_cuenta", ["ACTIVO", "INGRESO", "EGRESO"]);

export const cuentasCaja = pgTable(
  "cuentas_caja",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Identificador estable: "CUENTA", "EFECTIVO:<id admin>", "INGRESO:CUOTAS", "EGRESO:CARNE"... */
    codigo: text().notNull().unique(),
    nombre: text().notNull(),
    tipo: tipoCuenta().notNull(),
    /** Solo para las cuentas de efectivo: qué admin tiene esa plata. */
    adminId: uuid().references(() => admins.id),
    activa: boolean().notNull().default(true),
    ...tiempos,
  },
  (t) => [
    check("cuentas_efectivo_con_admin", sql`(${t.adminId} IS NULL) OR (${t.tipo} = 'ACTIVO')`),
  ],
);

export const origenAsiento = pgEnum("origen_asiento", [
  "PAGO",
  "GASTO",
  "RENDICION",
  "ANULACION",
  "AJUSTE",
  "ADELANTO",
]);

export const asientosCaja = pgTable(
  "asientos_caja",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Cuándo ocurrió el movimiento de plata (puede ser distinto de cuándo se cargó). */
    fecha: momento().notNull(),
    descripcion: text().notNull(),
    origen: origenAsiento().notNull(),
    /** Id del pago, gasto o rendición que lo originó. */
    origenId: text(),
    /** Si este asiento anula a otro, cuál. Cada asiento se puede anular una sola vez. */
    anulaAsientoId: uuid()
      .unique()
      .references((): AnyPgColumn => asientosCaja.id),
    creadoPorAdminId: uuid().references(() => admins.id),
    creadoEn: momento().notNull().defaultNow(),
  },
  (t) => [
    index("asientos_fecha").on(t.fecha),
    index("asientos_origen").on(t.origen, t.origenId),
    check(
      "asientos_anulacion_coherente",
      sql`(${t.origen} = 'ANULACION') = (${t.anulaAsientoId} IS NOT NULL)`,
    ),
  ],
);

export const movimientosCaja = pgTable(
  "movimientos_caja",
  {
    id: uuid().primaryKey().defaultRandom(),
    asientoId: uuid()
      .notNull()
      .references(() => asientosCaja.id),
    cuentaId: uuid()
      .notNull()
      .references(() => cuentasCaja.id),
    montoCentavos: bigint({ mode: "bigint" }).notNull(),
  },
  (t) => [
    index("movimientos_asiento").on(t.asientoId),
    index("movimientos_cuenta").on(t.cuentaId),
    check("movimientos_monto_no_cero", sql`${t.montoCentavos} <> 0`),
  ],
);

// ---------------------------------------------------------------------------
// Parámetros que fija el dueño (por ejemplo, el precio de los invitados).
// ---------------------------------------------------------------------------

export const parametros = pgTable("parametros", {
  clave: text().primaryKey(),
  valor: text().notNull(),
  actualizadoPorAdminId: uuid().references(() => admins.id),
  actualizadoEn: momento().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sábados
// ---------------------------------------------------------------------------

export const sabados = pgTable("sabados", {
  id: uuid().primaryKey().defaultRandom(),
  /** Fecha del sábado (día en Argentina), "AAAA-MM-DD". */
  fecha: date({ mode: "string" }).notNull().unique(),
  esLocal: boolean().notNull().default(false),
  notas: text(),
  ...tiempos,
});

// ---------------------------------------------------------------------------
// Pagos: toda la plata que entra (por ahora, invitados; después cuotas y entradas).
// Un pago no se borra ni se modifica: solo se anula (la base lo controla).
// ---------------------------------------------------------------------------

export const origenPago = pgEnum("origen_pago", ["CUOTA", "INVITADO", "ENTRADA_FIESTA", "OTRO"]);
export const medioPago = pgEnum("medio_pago", ["TRANSFERENCIA", "EFECTIVO"]);
export const estadoRegistro = pgEnum("estado_registro", ["CONFIRMADO", "ANULADO"]);

const anulacion = {
  estado: estadoRegistro().notNull().default("CONFIRMADO"),
  anuladoEn: momento(),
  anuladoPorAdminId: uuid().references(() => admins.id),
  motivoAnulacion: text(),
  anulacionAsientoId: uuid().references(() => asientosCaja.id),
};

const anulacionCoherente = (nombre: string, t: { estado: AnyPgColumn; anuladoEn: AnyPgColumn; motivoAnulacion: AnyPgColumn; anulacionAsientoId: AnyPgColumn }) =>
  check(
    nombre,
    sql`(${t.estado} = 'ANULADO') = (${t.anuladoEn} IS NOT NULL AND ${t.motivoAnulacion} IS NOT NULL AND ${t.anulacionAsientoId} IS NOT NULL)`,
  );

export const pagos = pgTable(
  "pagos",
  {
    id: uuid().primaryKey().defaultRandom(),
    origen: origenPago().notNull(),
    montoCentavos: bigint({ mode: "bigint" }).notNull(),
    medio: medioPago().notNull(),
    fecha: momento().notNull(),
    sabadoId: uuid().references(() => sabados.id),
    /** Opcionales: quién pagó (para invitados se puede dejar vacío). */
    nombrePagador: text(),
    camadaPagador: text(),
    nota: text(),
    /** Para cuotas: de qué jugador es el pago. */
    jugadorId: uuid().references((): AnyPgColumn => jugadores.id),
    /** Si fue en efectivo, qué admin tiene la plata. */
    recibidoPorAdminId: uuid().references(() => admins.id),
    registradoPorAdminId: uuid().references(() => admins.id),
    asientoId: uuid()
      .notNull()
      .unique()
      .references(() => asientosCaja.id),
    ...anulacion,
    ...tiempos,
  },
  (t) => [
    index("pagos_sabado").on(t.sabadoId),
    index("pagos_fecha").on(t.fecha),
    check("pagos_monto_positivo", sql`${t.montoCentavos} > 0`),
    check("pagos_efectivo_con_receptor", sql`(${t.medio} <> 'EFECTIVO') OR (${t.recibidoPorAdminId} IS NOT NULL)`),
    check("pagos_invitado_con_sabado", sql`(${t.origen} <> 'INVITADO') OR (${t.sabadoId} IS NOT NULL)`),
    check("pagos_cuota_con_jugador", sql`(${t.origen} <> 'CUOTA') OR (${t.jugadorId} IS NOT NULL)`),
    index("pagos_jugador").on(t.jugadorId),
    anulacionCoherente("pagos_anulacion_coherente", t),
  ],
);

// ---------------------------------------------------------------------------
// Cocina de la camada (sábados de local)
// ---------------------------------------------------------------------------

export const estadoCocina = pgEnum("estado_cocina", ["ABIERTA", "CERRADA"]);

export const cocinas = pgTable(
  "cocinas",
  {
    id: uuid().primaryKey().defaultRandom(),
    sabadoId: uuid()
      .notNull()
      .unique()
      .references(() => sabados.id),
    camada: text().notNull(),
    responsableNombre: text().notNull(),
    responsableTelefono: text(),
    /** Hash del token del link del responsable. El link solo se ve al crearlo o regenerarlo. */
    tokenHash: text().notNull().unique(),
    estado: estadoCocina().notNull().default("ABIERTA"),
    cerradaEn: momento(),
    cerradaPorAdminId: uuid().references(() => admins.id),
    notaCierre: text(),
    ...tiempos,
  },
  (t) => [check("cocinas_cierre_coherente", sql`(${t.estado} = 'CERRADA') = (${t.cerradaEn} IS NOT NULL)`)],
);

/** Plata que va y viene entre el plantel y la camada que cocina. */
export const tipoMovimientoCocina = pgEnum("tipo_movimiento_cocina", [
  /** El plantel le transfiere plata a la camada. */
  "ADELANTO",
  /** La camada devuelve lo que sobró. */
  "DEVOLUCION",
  /** El plantel le devuelve a la camada lo que gastó de más. */
  "REINTEGRO",
  /** Al cerrar, sobró plata y el dueño decide no reclamarla. */
  "SOBRANTE_NO_DEVUELTO",
  /** Al cerrar, la camada gastó de más y el dueño decide no reintegrarlo (lo pone la camada). */
  "EXCESO_NO_REINTEGRADO",
]);

export const movimientosCocina = pgTable(
  "movimientos_cocina",
  {
    id: uuid().primaryKey().defaultRandom(),
    cocinaId: uuid()
      .notNull()
      .references(() => cocinas.id),
    tipo: tipoMovimientoCocina().notNull(),
    montoCentavos: bigint({ mode: "bigint" }).notNull(),
    medio: medioPago(),
    nota: text(),
    registradoPorAdminId: uuid()
      .notNull()
      .references(() => admins.id),
    asientoId: uuid()
      .notNull()
      .unique()
      .references(() => asientosCaja.id),
    ...anulacion,
    ...tiempos,
  },
  (t) => [
    index("movimientos_cocina_cocina").on(t.cocinaId),
    check("movimientos_cocina_monto_positivo", sql`${t.montoCentavos} > 0`),
    anulacionCoherente("movimientos_cocina_anulacion_coherente", t),
  ],
);

// ---------------------------------------------------------------------------
// Gastos: toda la plata que sale para comprar algo, con su detalle producto por producto.
// ---------------------------------------------------------------------------

export const categoriaGasto = pgEnum("categoria_gasto", ["CARNE", "BEBIDAS", "INSUMOS", "OTROS"]);
export const origenCarga = pgEnum("origen_carga", ["IA", "MANUAL"]);

export const gastos = pgTable(
  "gastos",
  {
    id: uuid().primaryKey().defaultRandom(),
    fecha: momento().notNull(),
    proveedor: text(),
    descripcion: text().notNull(),
    totalCentavos: bigint({ mode: "bigint" }).notNull(),
    /** De qué cuenta salió la plata: la de la cocina, la cuenta del plantel o el efectivo de un admin. */
    cuentaOrigenCodigo: text().notNull(),
    cocinaId: uuid().references(() => cocinas.id),
    sabadoId: uuid().references(() => sabados.id),
    origenCarga: origenCarga().notNull(),
    /** Null si lo cargó el responsable de la camada desde su link. */
    registradoPorAdminId: uuid().references(() => admins.id),
    asientoId: uuid()
      .notNull()
      .unique()
      .references(() => asientosCaja.id),
    ...anulacion,
    ...tiempos,
  },
  (t) => [
    index("gastos_cocina").on(t.cocinaId),
    index("gastos_fecha").on(t.fecha),
    check("gastos_total_positivo", sql`${t.totalCentavos} > 0`),
    anulacionCoherente("gastos_anulacion_coherente", t),
  ],
);

export const gastoItems = pgTable(
  "gasto_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    gastoId: uuid()
      .notNull()
      .references(() => gastos.id),
    descripcion: text().notNull(),
    /** Texto libre: "15 kg", "6 unidades". No es plata. */
    cantidad: text(),
    categoria: categoriaGasto().notNull(),
    subtotalCentavos: bigint({ mode: "bigint" }).notNull(),
  },
  (t) => [index("gasto_items_gasto").on(t.gastoId), check("gasto_items_subtotal_positivo", sql`${t.subtotalCentavos} > 0`)],
);

// ---------------------------------------------------------------------------
// Archivos (fotos de tickets). Se guardan comprimidos en la base: son pocos y chicos.
// ---------------------------------------------------------------------------

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const archivos = pgTable("archivos", {
  id: uuid().primaryKey().defaultRandom(),
  tipoMime: text().notNull(),
  tamanoBytes: bigint({ mode: "number" }).notNull(),
  sha256: text().notNull(),
  contenido: bytes().notNull(),
  creadoEn: momento().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Tickets: una foto que la IA lee y convierte en gasto.
// ---------------------------------------------------------------------------

export const estadoTicket = pgEnum("estado_ticket", [
  /** La IA lo leyó, los números cerraron y ya es un gasto. */
  "REGISTRADO",
  /** La IA no pudo leerlo bien o los números no cierran: lo tiene que mirar un admin. */
  "REVISAR",
  /** Un admin decidió que no corresponde (foto repetida, no es un ticket...). */
  "DESCARTADO",
]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid().primaryKey().defaultRandom(),
    cocinaId: uuid().references(() => cocinas.id),
    archivoId: uuid()
      .notNull()
      .references(() => archivos.id),
    estado: estadoTicket().notNull(),
    /** Lo que leyó la IA, tal cual. */
    lecturaIa: jsonb(),
    /** Por qué quedó para revisar. */
    motivoRevision: text(),
    gastoId: uuid().references(() => gastos.id),
    /** Para tickets de Caja (no de una cocina): de qué cuenta sale la plata. */
    cuentaOrigenCodigo: text(),
    subidoPorAdminId: uuid().references(() => admins.id),
    resueltoPorAdminId: uuid().references(() => admins.id),
    ...tiempos,
  },
  (t) => [
    index("tickets_cocina").on(t.cocinaId),
    index("tickets_estado").on(t.estado),
    check("tickets_registrado_con_gasto", sql`(${t.estado} = 'REGISTRADO') = (${t.gastoId} IS NOT NULL)`),
    check("tickets_con_destino", sql`(${t.cocinaId} IS NOT NULL) <> (${t.cuentaOrigenCodigo} IS NOT NULL)`),
  ],
);

// ---------------------------------------------------------------------------
// Efectivo con responsable: traspasos entre admins (el que recibe confirma).
// ---------------------------------------------------------------------------

export const estadoTraspaso = pgEnum("estado_traspaso", ["PENDIENTE", "CONFIRMADO", "RECHAZADO", "CANCELADO"]);

export const traspasosEfectivo = pgTable(
  "traspasos_efectivo",
  {
    id: uuid().primaryKey().defaultRandom(),
    deAdminId: uuid()
      .notNull()
      .references(() => admins.id),
    paraAdminId: uuid()
      .notNull()
      .references(() => admins.id),
    montoCentavos: bigint({ mode: "bigint" }).notNull(),
    nota: text(),
    estado: estadoTraspaso().notNull().default("PENDIENTE"),
    /** El asiento existe solo si se confirmó. */
    asientoId: uuid()
      .unique()
      .references(() => asientosCaja.id),
    resueltoEn: momento(),
    ...tiempos,
  },
  (t) => [
    index("traspasos_para").on(t.paraAdminId, t.estado),
    index("traspasos_de").on(t.deAdminId, t.estado),
    check("traspasos_monto_positivo", sql`${t.montoCentavos} > 0`),
    check("traspasos_entre_distintos", sql`${t.deAdminId} <> ${t.paraAdminId}`),
    check("traspasos_confirmado_con_asiento", sql`(${t.estado} = 'CONFIRMADO') = (${t.asientoId} IS NOT NULL)`),
  ],
);

// ---------------------------------------------------------------------------
// Control de caja: lo que el dueño ve en la reserva contra lo que dice el libro.
// ---------------------------------------------------------------------------

export const controlesCaja = pgTable("controles_caja", {
  id: uuid().primaryKey().defaultRandom(),
  declaradoCentavos: bigint({ mode: "bigint" }).notNull(),
  libroCentavos: bigint({ mode: "bigint" }).notNull(),
  diferenciaCentavos: bigint({ mode: "bigint" }).notNull(),
  ajusteAsientoId: uuid().references(() => asientosCaja.id),
  motivo: text(),
  realizadoPorAdminId: uuid()
    .notNull()
    .references(() => admins.id),
  creadoEn: momento().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Verificación de transferencias (etapa 6): comprobantes y entradas de Mercado Pago usadas.
// ---------------------------------------------------------------------------

/** Para qué es el comprobante. Lo usan fiestas (etapa 7) y cuotas (etapa 9). */
export const destinoComprobante = pgEnum("destino_comprobante", ["CUOTA", "ENTRADA_FIESTA"]);

export const estadoComprobante = pgEnum("estado_comprobante", [
  /** Coincidió con una entrada real de la cuenta según la regla: se confirmó solo. */
  "VERIFICADO_AUTO",
  /** Hubo alguna duda: lo tiene que mirar un admin. */
  "REVISAR",
  /** Un admin lo confirmó a mano, eligiendo la entrada de la cuenta que le corresponde. */
  "CONFIRMADO",
  /** Un admin decidió que no corresponde (con motivo). */
  "RECHAZADO",
]);

/**
 * Entradas de la cuenta de Mercado Pago que ya confirmaron un pago. Solo se guardan las que coinciden
 * con un pago del plantel (opción A). La clave primaria es el número de Mercado Pago: un movimiento
 * confirma como máximo un pago, y un número de operación no se usa dos veces.
 */
export const entradasMercadoPago = pgTable(
  "entradas_mercado_pago",
  {
    mpPagoId: text().primaryKey(),
    e2eId: text(),
    montoCentavos: bigint({ mode: "bigint" }).notNull(),
    fecha: momento().notNull(),
    cuitPagador: text(),
    creadoEn: momento().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("entradas_mp_e2e").on(t.e2eId),
    check("entradas_mp_monto_positivo", sql`${t.montoCentavos} > 0`),
  ],
);

export const comprobantes = pgTable(
  "comprobantes",
  {
    id: uuid().primaryKey().defaultRandom(),
    destino: destinoComprobante().notNull(),
    /** La cuota o la entrada a la que corresponde (sus tablas llegan en las etapas 7 y 9). */
    referenciaId: uuid(),
    /** Lo que había que pagar, si se sabe. */
    montoEsperadoCentavos: bigint({ mode: "bigint" }),
    archivoId: uuid()
      .notNull()
      .references(() => archivos.id),
    estado: estadoComprobante().notNull(),
    /** Lo que leyó la IA, tal cual. */
    lecturaIa: jsonb(),
    codigoRevision: text(),
    motivoRevision: text(),
    /** Entradas de la cuenta que podrían corresponder (sin datos de otras personas: número, monto y fecha). */
    candidatos: jsonb(),
    /** La entrada de la cuenta con la que se confirmó. Única: no se usa dos veces. */
    mpPagoId: text()
      .unique()
      .references(() => entradasMercadoPago.mpPagoId),
    confirmadoPor: text(),
    subidoPor: text(),
    resueltoPorAdminId: uuid().references(() => admins.id),
    motivoRechazo: text(),
    ...tiempos,
  },
  (t) => [
    index("comprobantes_estado").on(t.estado),
    index("comprobantes_referencia").on(t.referenciaId),
    check(
      "comprobantes_confirmado_con_entrada",
      sql`(${t.estado} IN ('VERIFICADO_AUTO', 'CONFIRMADO')) = (${t.mpPagoId} IS NOT NULL)`,
    ),
    check("comprobantes_rechazo_con_motivo", sql`(${t.estado} <> 'RECHAZADO') OR (${t.motivoRechazo} IS NOT NULL)`),
    check(
      "comprobantes_monto_esperado_positivo",
      sql`${t.montoEsperadoCentavos} IS NULL OR ${t.montoEsperadoCentavos} > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Jugadores (etapa 7). El DNI es lo que usa la verificación automática de transferencias.
// ---------------------------------------------------------------------------

export const estadoJugador = pgEnum("estado_jugador", [
  "ACTIVO",
  /** Dado de baja por el dueño: no genera cuotas ni aparece en listas. Se puede reactivar. */
  "BAJA",
  /** Eliminado por el dueño teniendo pagos: se borraron sus datos personales y queda como "Jugador eliminado". */
  "ELIMINADO",
]);

export const jugadores = pgTable(
  "jugadores",
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text(),
    apellido: text(),
    /** Solo números, sin ceros a la izquierda ("30123456"). */
    dni: text(),
    telefono: text(),
    email: text(),
    camada: text(),
    estado: estadoJugador().notNull().default("ACTIVO"),
    bajaEn: momento(),
    eliminadoEn: momento(),
    ...tiempos,
  },
  (t) => [
    uniqueIndex("jugadores_dni").on(t.dni),
    index("jugadores_estado").on(t.estado),
    check(
      "jugadores_datos_segun_estado",
      sql`CASE WHEN ${t.estado} = 'ELIMINADO'
        THEN ${t.nombre} IS NULL AND ${t.apellido} IS NULL AND ${t.dni} IS NULL AND ${t.telefono} IS NULL AND ${t.email} IS NULL AND ${t.eliminadoEn} IS NOT NULL
        ELSE ${t.nombre} IS NOT NULL AND ${t.apellido} IS NOT NULL AND ${t.dni} IS NOT NULL END`,
    ),
    check("jugadores_dni_valido", sql`${t.dni} IS NULL OR ${t.dni} ~ '^[1-9][0-9]{6,7}$'`),
    check("jugadores_baja_con_fecha", sql`(${t.estado} = 'BAJA') = (${t.bajaEn} IS NOT NULL)`),
  ],
);

// ---------------------------------------------------------------------------
// Cuotas (etapa 8): los meses que abre el dueño y lo que debe cada jugador.
// ---------------------------------------------------------------------------

export const periodosCuota = pgTable(
  "periodos_cuota",
  {
    id: uuid().primaryKey().defaultRandom(),
    anio: integer().notNull(),
    mes: integer().notNull(),
    montoCentavos: bigint({ mode: "bigint" }).notNull(),
    nota: text(),
    abiertoPorAdminId: uuid()
      .notNull()
      .references(() => admins.id),
    ...tiempos,
  },
  (t) => [
    uniqueIndex("periodos_anio_mes").on(t.anio, t.mes),
    check("periodos_mes_valido", sql`${t.mes} BETWEEN 1 AND 12`),
    check("periodos_anio_valido", sql`${t.anio} BETWEEN 2026 AND 2100`),
    check("periodos_monto_positivo", sql`${t.montoCentavos} > 0`),
  ],
);

export const estadoCargo = pgEnum("estado_cargo", ["PENDIENTE", "PAGADO", "ANULADO"]);

/** Lo que debe un jugador en un mes. Se paga entero con un solo pago (no hay pagos parciales). */
export const cargos = pgTable(
  "cargos",
  {
    id: uuid().primaryKey().defaultRandom(),
    jugadorId: uuid()
      .notNull()
      .references(() => jugadores.id),
    periodoId: uuid()
      .notNull()
      .references(() => periodosCuota.id),
    montoCentavos: bigint({ mode: "bigint" }).notNull(),
    estado: estadoCargo().notNull().default("PENDIENTE"),
    pagoId: uuid().references(() => pagos.id),
    motivoAnulacion: text(),
    anuladoPorAdminId: uuid().references(() => admins.id),
    anuladoEn: momento(),
    ...tiempos,
  },
  (t) => [
    uniqueIndex("cargos_jugador_periodo").on(t.jugadorId, t.periodoId),
    index("cargos_periodo_estado").on(t.periodoId, t.estado),
    index("cargos_pago").on(t.pagoId),
    check("cargos_monto_positivo", sql`${t.montoCentavos} > 0`),
    check("cargos_pagado_con_pago", sql`(${t.estado} = 'PAGADO') = (${t.pagoId} IS NOT NULL)`),
    check("cargos_anulado_con_motivo", sql`(${t.estado} <> 'ANULADO') OR (${t.motivoAnulacion} IS NOT NULL AND ${t.anuladoEn} IS NOT NULL)`),
  ],
);
