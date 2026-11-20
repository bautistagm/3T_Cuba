CREATE TYPE "public"."categoria_gasto" AS ENUM('CARNE', 'BEBIDAS', 'INSUMOS', 'OTROS');--> statement-breakpoint
CREATE TYPE "public"."estado_cocina" AS ENUM('ABIERTA', 'CERRADA');--> statement-breakpoint
CREATE TYPE "public"."estado_registro" AS ENUM('CONFIRMADO', 'ANULADO');--> statement-breakpoint
CREATE TYPE "public"."medio_pago" AS ENUM('TRANSFERENCIA', 'EFECTIVO');--> statement-breakpoint
CREATE TYPE "public"."origen_carga" AS ENUM('IA', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."origen_pago" AS ENUM('CUOTA', 'INVITADO', 'ENTRADA_FIESTA', 'OTRO');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento_cocina" AS ENUM('ADELANTO', 'DEVOLUCION', 'REINTEGRO', 'SOBRANTE_NO_DEVUELTO', 'EXCESO_NO_REINTEGRADO');--> statement-breakpoint
ALTER TYPE "public"."origen_asiento" ADD VALUE 'ADELANTO';--> statement-breakpoint
CREATE TABLE "cocinas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sabado_id" uuid NOT NULL,
	"camada" text NOT NULL,
	"responsable_nombre" text NOT NULL,
	"responsable_telefono" text,
	"token_hash" text NOT NULL,
	"estado" "estado_cocina" DEFAULT 'ABIERTA' NOT NULL,
	"cerrada_en" timestamp with time zone,
	"cerrada_por_admin_id" uuid,
	"nota_cierre" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cocinas_sabadoId_unique" UNIQUE("sabado_id"),
	CONSTRAINT "cocinas_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "cocinas_cierre_coherente" CHECK (("cocinas"."estado" = 'CERRADA') = ("cocinas"."cerrada_en" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "gasto_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasto_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"cantidad" text,
	"categoria" "categoria_gasto" NOT NULL,
	"subtotal_centavos" bigint NOT NULL,
	CONSTRAINT "gasto_items_subtotal_positivo" CHECK ("gasto_items"."subtotal_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "gastos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"proveedor" text,
	"descripcion" text NOT NULL,
	"total_centavos" bigint NOT NULL,
	"cuenta_origen_codigo" text NOT NULL,
	"cocina_id" uuid,
	"sabado_id" uuid,
	"origen_carga" "origen_carga" NOT NULL,
	"registrado_por_admin_id" uuid,
	"asiento_id" uuid NOT NULL,
	"estado" "estado_registro" DEFAULT 'CONFIRMADO' NOT NULL,
	"anulado_en" timestamp with time zone,
	"anulado_por_admin_id" uuid,
	"motivo_anulacion" text,
	"anulacion_asiento_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gastos_asientoId_unique" UNIQUE("asiento_id"),
	CONSTRAINT "gastos_total_positivo" CHECK ("gastos"."total_centavos" > 0),
	CONSTRAINT "gastos_anulacion_coherente" CHECK (("gastos"."estado" = 'ANULADO') = ("gastos"."anulado_en" IS NOT NULL AND "gastos"."motivo_anulacion" IS NOT NULL AND "gastos"."anulacion_asiento_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "movimientos_cocina" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cocina_id" uuid NOT NULL,
	"tipo" "tipo_movimiento_cocina" NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"medio" "medio_pago",
	"nota" text,
	"registrado_por_admin_id" uuid NOT NULL,
	"asiento_id" uuid NOT NULL,
	"estado" "estado_registro" DEFAULT 'CONFIRMADO' NOT NULL,
	"anulado_en" timestamp with time zone,
	"anulado_por_admin_id" uuid,
	"motivo_anulacion" text,
	"anulacion_asiento_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimientos_cocina_asientoId_unique" UNIQUE("asiento_id"),
	CONSTRAINT "movimientos_cocina_monto_positivo" CHECK ("movimientos_cocina"."monto_centavos" > 0),
	CONSTRAINT "movimientos_cocina_anulacion_coherente" CHECK (("movimientos_cocina"."estado" = 'ANULADO') = ("movimientos_cocina"."anulado_en" IS NOT NULL AND "movimientos_cocina"."motivo_anulacion" IS NOT NULL AND "movimientos_cocina"."anulacion_asiento_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origen" "origen_pago" NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"medio" "medio_pago" NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"sabado_id" uuid,
	"nombre_pagador" text,
	"camada_pagador" text,
	"nota" text,
	"recibido_por_admin_id" uuid,
	"registrado_por_admin_id" uuid,
	"asiento_id" uuid NOT NULL,
	"estado" "estado_registro" DEFAULT 'CONFIRMADO' NOT NULL,
	"anulado_en" timestamp with time zone,
	"anulado_por_admin_id" uuid,
	"motivo_anulacion" text,
	"anulacion_asiento_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagos_asientoId_unique" UNIQUE("asiento_id"),
	CONSTRAINT "pagos_monto_positivo" CHECK ("pagos"."monto_centavos" > 0),
	CONSTRAINT "pagos_efectivo_con_receptor" CHECK (("pagos"."medio" <> 'EFECTIVO') OR ("pagos"."recibido_por_admin_id" IS NOT NULL)),
	CONSTRAINT "pagos_invitado_con_sabado" CHECK (("pagos"."origen" <> 'INVITADO') OR ("pagos"."sabado_id" IS NOT NULL)),
	CONSTRAINT "pagos_anulacion_coherente" CHECK (("pagos"."estado" = 'ANULADO') = ("pagos"."anulado_en" IS NOT NULL AND "pagos"."motivo_anulacion" IS NOT NULL AND "pagos"."anulacion_asiento_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "parametros" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"actualizado_por_admin_id" uuid,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sabados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" date NOT NULL,
	"es_local" boolean DEFAULT false NOT NULL,
	"notas" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sabados_fecha_unique" UNIQUE("fecha")
);
--> statement-breakpoint
ALTER TABLE "cocinas" ADD CONSTRAINT "cocinas_sabado_id_sabados_id_fk" FOREIGN KEY ("sabado_id") REFERENCES "public"."sabados"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cocinas" ADD CONSTRAINT "cocinas_cerrada_por_admin_id_admins_id_fk" FOREIGN KEY ("cerrada_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto_items" ADD CONSTRAINT "gasto_items_gasto_id_gastos_id_fk" FOREIGN KEY ("gasto_id") REFERENCES "public"."gastos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_cocina_id_cocinas_id_fk" FOREIGN KEY ("cocina_id") REFERENCES "public"."cocinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_sabado_id_sabados_id_fk" FOREIGN KEY ("sabado_id") REFERENCES "public"."sabados"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_registrado_por_admin_id_admins_id_fk" FOREIGN KEY ("registrado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_anulado_por_admin_id_admins_id_fk" FOREIGN KEY ("anulado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_anulacion_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("anulacion_asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_cocina" ADD CONSTRAINT "movimientos_cocina_cocina_id_cocinas_id_fk" FOREIGN KEY ("cocina_id") REFERENCES "public"."cocinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_cocina" ADD CONSTRAINT "movimientos_cocina_registrado_por_admin_id_admins_id_fk" FOREIGN KEY ("registrado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_cocina" ADD CONSTRAINT "movimientos_cocina_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_cocina" ADD CONSTRAINT "movimientos_cocina_anulado_por_admin_id_admins_id_fk" FOREIGN KEY ("anulado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_cocina" ADD CONSTRAINT "movimientos_cocina_anulacion_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("anulacion_asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_sabado_id_sabados_id_fk" FOREIGN KEY ("sabado_id") REFERENCES "public"."sabados"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_recibido_por_admin_id_admins_id_fk" FOREIGN KEY ("recibido_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_registrado_por_admin_id_admins_id_fk" FOREIGN KEY ("registrado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_anulado_por_admin_id_admins_id_fk" FOREIGN KEY ("anulado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_anulacion_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("anulacion_asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parametros" ADD CONSTRAINT "parametros_actualizado_por_admin_id_admins_id_fk" FOREIGN KEY ("actualizado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gasto_items_gasto" ON "gasto_items" USING btree ("gasto_id");--> statement-breakpoint
CREATE INDEX "gastos_cocina" ON "gastos" USING btree ("cocina_id");--> statement-breakpoint
CREATE INDEX "gastos_fecha" ON "gastos" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "movimientos_cocina_cocina" ON "movimientos_cocina" USING btree ("cocina_id");--> statement-breakpoint
CREATE INDEX "pagos_sabado" ON "pagos" USING btree ("sabado_id");--> statement-breakpoint
CREATE INDEX "pagos_fecha" ON "pagos" USING btree ("fecha");