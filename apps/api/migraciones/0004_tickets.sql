CREATE TYPE "public"."estado_ticket" AS ENUM('REGISTRADO', 'REVISAR', 'DESCARTADO');--> statement-breakpoint
CREATE TABLE "archivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo_mime" text NOT NULL,
	"tamano_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"contenido" "bytea" NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cocina_id" uuid,
	"archivo_id" uuid NOT NULL,
	"estado" "estado_ticket" NOT NULL,
	"lectura_ia" jsonb,
	"motivo_revision" text,
	"gasto_id" uuid,
	"subido_por_admin_id" uuid,
	"resuelto_por_admin_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_registrado_con_gasto" CHECK (("tickets"."estado" = 'REGISTRADO') = ("tickets"."gasto_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_cocina_id_cocinas_id_fk" FOREIGN KEY ("cocina_id") REFERENCES "public"."cocinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_archivo_id_archivos_id_fk" FOREIGN KEY ("archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_gasto_id_gastos_id_fk" FOREIGN KEY ("gasto_id") REFERENCES "public"."gastos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_subido_por_admin_id_admins_id_fk" FOREIGN KEY ("subido_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_resuelto_por_admin_id_admins_id_fk" FOREIGN KEY ("resuelto_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_cocina" ON "tickets" USING btree ("cocina_id");--> statement-breakpoint
CREATE INDEX "tickets_estado" ON "tickets" USING btree ("estado");