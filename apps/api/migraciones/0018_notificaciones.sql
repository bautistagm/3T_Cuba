CREATE TYPE "public"."estado_notificacion" AS ENUM('PENDIENTE', 'ENVIADA', 'FALLIDA');--> statement-breakpoint
CREATE TABLE "notificaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"compra_id" uuid,
	"destinatario" text NOT NULL,
	"estado" "estado_notificacion" DEFAULT 'PENDIENTE' NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"ultimo_error" text,
	"proximo_intento" timestamp with time zone DEFAULT now() NOT NULL,
	"enviada_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_compra_id_compras_entradas_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras_entradas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notificaciones_pendientes" ON "notificaciones" USING btree ("estado","proximo_intento");--> statement-breakpoint
CREATE INDEX "notificaciones_compra" ON "notificaciones" USING btree ("compra_id");