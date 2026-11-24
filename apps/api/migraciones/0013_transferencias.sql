CREATE TYPE "public"."estado_transferencia" AS ENUM('CONFIRMADA', 'REVISAR', 'RESUELTA');--> statement-breakpoint
CREATE TYPE "public"."resolucion_transferencia" AS ENUM('CUOTA_AUTO', 'CUOTA_MANUAL', 'YA_REGISTRADA', 'OTRO_INGRESO', 'NO_ES_DEL_PLANTEL');--> statement-breakpoint
CREATE TABLE "transferencias_recibidas" (
	"mp_pago_id" text PRIMARY KEY NOT NULL,
	"e2e_id" text,
	"monto_centavos" bigint NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"cuit_pagador" text,
	"dni_pagador" text,
	"estado" "estado_transferencia" NOT NULL,
	"resolucion" "resolucion_transferencia",
	"pago_id" uuid,
	"jugador_sugerido_id" uuid,
	"motivo_revision" text,
	"nota" text,
	"resuelto_por_admin_id" uuid,
	"resuelto_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transferencias_recibidas_pagoId_unique" UNIQUE("pago_id"),
	CONSTRAINT "transferencias_monto_positivo" CHECK ("transferencias_recibidas"."monto_centavos" > 0),
	CONSTRAINT "transferencias_revisar_sin_resolucion" CHECK (("transferencias_recibidas"."estado" = 'REVISAR') = ("transferencias_recibidas"."resolucion" IS NULL)),
	CONSTRAINT "transferencias_pago_segun_resolucion" CHECK (("transferencias_recibidas"."resolucion" IN ('CUOTA_AUTO', 'CUOTA_MANUAL', 'OTRO_INGRESO')) = ("transferencias_recibidas"."pago_id" IS NOT NULL)),
	CONSTRAINT "transferencias_confirmada_es_auto" CHECK (("transferencias_recibidas"."estado" = 'CONFIRMADA') = ("transferencias_recibidas"."resolucion" IS NOT DISTINCT FROM 'CUOTA_AUTO'))
);
--> statement-breakpoint
ALTER TABLE "transferencias_recibidas" ADD CONSTRAINT "transferencias_recibidas_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias_recibidas" ADD CONSTRAINT "transferencias_recibidas_jugador_sugerido_id_jugadores_id_fk" FOREIGN KEY ("jugador_sugerido_id") REFERENCES "public"."jugadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias_recibidas" ADD CONSTRAINT "transferencias_recibidas_resuelto_por_admin_id_admins_id_fk" FOREIGN KEY ("resuelto_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transferencias_estado" ON "transferencias_recibidas" USING btree ("estado","fecha");