CREATE TYPE "public"."origen_asiento" AS ENUM('PAGO', 'GASTO', 'RENDICION', 'ANULACION', 'AJUSTE');--> statement-breakpoint
CREATE TYPE "public"."rol_admin" AS ENUM('DUENO', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."tipo_actor" AS ENUM('ADMIN', 'SISTEMA', 'PUBLICO');--> statement-breakpoint
CREATE TYPE "public"."tipo_cuenta" AS ENUM('ACTIVO', 'INGRESO', 'EGRESO');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"telefono" text,
	"rol" "rol_admin" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"hash_contrasena" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asientos_caja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"descripcion" text NOT NULL,
	"origen" "origen_asiento" NOT NULL,
	"origen_id" text,
	"anula_asiento_id" uuid,
	"creado_por_admin_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asientos_caja_anulaAsientoId_unique" UNIQUE("anula_asiento_id"),
	CONSTRAINT "asientos_anulacion_coherente" CHECK (("asientos_caja"."origen" = 'ANULACION') = ("asientos_caja"."anula_asiento_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_tipo" "tipo_actor" NOT NULL,
	"actor_admin_id" uuid,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text NOT NULL,
	"antes" jsonb,
	"despues" jsonb,
	"ip" text,
	CONSTRAINT "auditoria_actor_admin" CHECK (("auditoria"."actor_tipo" = 'ADMIN') = ("auditoria"."actor_admin_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "cuentas_caja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_cuenta" NOT NULL,
	"admin_id" uuid,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cuentas_caja_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "cuentas_efectivo_con_admin" CHECK (("cuentas_caja"."admin_id" IS NULL) OR ("cuentas_caja"."tipo" = 'ACTIVO'))
);
--> statement-breakpoint
CREATE TABLE "movimientos_caja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asiento_id" uuid NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"monto_centavos" bigint NOT NULL,
	CONSTRAINT "movimientos_monto_no_cero" CHECK ("movimientos_caja"."monto_centavos" <> 0)
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"revocada_en" timestamp with time zone,
	"ip" text,
	"navegador" text,
	CONSTRAINT "sesiones_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "asientos_caja" ADD CONSTRAINT "asientos_caja_anula_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("anula_asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asientos_caja" ADD CONSTRAINT "asientos_caja_creado_por_admin_id_admins_id_fk" FOREIGN KEY ("creado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_actor_admin_id_admins_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuentas_caja" ADD CONSTRAINT "cuentas_caja_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_cuenta_id_cuentas_caja_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admins_email_unico" ON "admins" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "admins_un_solo_dueno" ON "admins" USING btree ("rol") WHERE "admins"."rol" = 'DUENO';--> statement-breakpoint
CREATE INDEX "asientos_fecha" ON "asientos_caja" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "asientos_origen" ON "asientos_caja" USING btree ("origen","origen_id");--> statement-breakpoint
CREATE INDEX "auditoria_entidad" ON "auditoria" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "auditoria_fecha" ON "auditoria" USING btree ("creado_en");--> statement-breakpoint
CREATE INDEX "movimientos_asiento" ON "movimientos_caja" USING btree ("asiento_id");--> statement-breakpoint
CREATE INDEX "movimientos_cuenta" ON "movimientos_caja" USING btree ("cuenta_id");--> statement-breakpoint
CREATE INDEX "sesiones_admin" ON "sesiones" USING btree ("admin_id");