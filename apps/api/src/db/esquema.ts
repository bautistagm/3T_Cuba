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
  index,
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
