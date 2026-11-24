CREATE TYPE "public"."estado_cargo" AS ENUM('PENDIENTE', 'PAGADO', 'ANULADO');--> statement-breakpoint
CREATE TABLE "cargos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jugador_id" uuid NOT NULL,
	"periodo_id" uuid NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"estado" "estado_cargo" DEFAULT 'PENDIENTE' NOT NULL,
	"pago_id" uuid,
	"motivo_anulacion" text,
	"anulado_por_admin_id" uuid,
	"anulado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargos_monto_positivo" CHECK ("cargos"."monto_centavos" > 0),
	CONSTRAINT "cargos_pagado_con_pago" CHECK (("cargos"."estado" = 'PAGADO') = ("cargos"."pago_id" IS NOT NULL)),
	CONSTRAINT "cargos_anulado_con_motivo" CHECK (("cargos"."estado" <> 'ANULADO') OR ("cargos"."motivo_anulacion" IS NOT NULL AND "cargos"."anulado_en" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "periodos_cuota" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"nota" text,
	"abierto_por_admin_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periodos_mes_valido" CHECK ("periodos_cuota"."mes" BETWEEN 1 AND 12),
	CONSTRAINT "periodos_anio_valido" CHECK ("periodos_cuota"."anio" BETWEEN 2026 AND 2100),
	CONSTRAINT "periodos_monto_positivo" CHECK ("periodos_cuota"."monto_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "pagos" ADD COLUMN "jugador_id" uuid;--> statement-breakpoint
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_jugador_id_jugadores_id_fk" FOREIGN KEY ("jugador_id") REFERENCES "public"."jugadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_periodo_id_periodos_cuota_id_fk" FOREIGN KEY ("periodo_id") REFERENCES "public"."periodos_cuota"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_anulado_por_admin_id_admins_id_fk" FOREIGN KEY ("anulado_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodos_cuota" ADD CONSTRAINT "periodos_cuota_abierto_por_admin_id_admins_id_fk" FOREIGN KEY ("abierto_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cargos_jugador_periodo" ON "cargos" USING btree ("jugador_id","periodo_id");--> statement-breakpoint
CREATE INDEX "cargos_periodo_estado" ON "cargos" USING btree ("periodo_id","estado");--> statement-breakpoint
CREATE INDEX "cargos_pago" ON "cargos" USING btree ("pago_id");--> statement-breakpoint
CREATE UNIQUE INDEX "periodos_anio_mes" ON "periodos_cuota" USING btree ("anio","mes");--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_jugador_id_jugadores_id_fk" FOREIGN KEY ("jugador_id") REFERENCES "public"."jugadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pagos_jugador" ON "pagos" USING btree ("jugador_id");--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cuota_con_jugador" CHECK (("pagos"."origen" <> 'CUOTA') OR ("pagos"."jugador_id" IS NOT NULL));