CREATE TYPE "public"."estado_traspaso" AS ENUM('PENDIENTE', 'CONFIRMADO', 'RECHAZADO', 'CANCELADO');--> statement-breakpoint
CREATE TABLE "controles_caja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"declarado_centavos" bigint NOT NULL,
	"libro_centavos" bigint NOT NULL,
	"diferencia_centavos" bigint NOT NULL,
	"ajuste_asiento_id" uuid,
	"motivo" text,
	"realizado_por_admin_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traspasos_efectivo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"de_admin_id" uuid NOT NULL,
	"para_admin_id" uuid NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"nota" text,
	"estado" "estado_traspaso" DEFAULT 'PENDIENTE' NOT NULL,
	"asiento_id" uuid,
	"resuelto_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traspasos_efectivo_asientoId_unique" UNIQUE("asiento_id"),
	CONSTRAINT "traspasos_monto_positivo" CHECK ("traspasos_efectivo"."monto_centavos" > 0),
	CONSTRAINT "traspasos_entre_distintos" CHECK ("traspasos_efectivo"."de_admin_id" <> "traspasos_efectivo"."para_admin_id"),
	CONSTRAINT "traspasos_confirmado_con_asiento" CHECK (("traspasos_efectivo"."estado" = 'CONFIRMADO') = ("traspasos_efectivo"."asiento_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "cuenta_origen_codigo" text;--> statement-breakpoint
ALTER TABLE "controles_caja" ADD CONSTRAINT "controles_caja_ajuste_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("ajuste_asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controles_caja" ADD CONSTRAINT "controles_caja_realizado_por_admin_id_admins_id_fk" FOREIGN KEY ("realizado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traspasos_efectivo" ADD CONSTRAINT "traspasos_efectivo_de_admin_id_admins_id_fk" FOREIGN KEY ("de_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traspasos_efectivo" ADD CONSTRAINT "traspasos_efectivo_para_admin_id_admins_id_fk" FOREIGN KEY ("para_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traspasos_efectivo" ADD CONSTRAINT "traspasos_efectivo_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "traspasos_para" ON "traspasos_efectivo" USING btree ("para_admin_id","estado");--> statement-breakpoint
CREATE INDEX "traspasos_de" ON "traspasos_efectivo" USING btree ("de_admin_id","estado");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_con_destino" CHECK (("tickets"."cocina_id" IS NOT NULL) <> ("tickets"."cuenta_origen_codigo" IS NOT NULL));