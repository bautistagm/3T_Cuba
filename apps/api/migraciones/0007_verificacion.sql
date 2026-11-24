CREATE TYPE "public"."destino_comprobante" AS ENUM('CUOTA', 'ENTRADA_FIESTA');--> statement-breakpoint
CREATE TYPE "public"."estado_comprobante" AS ENUM('VERIFICADO_AUTO', 'REVISAR', 'CONFIRMADO', 'RECHAZADO');--> statement-breakpoint
CREATE TABLE "comprobantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destino" "destino_comprobante" NOT NULL,
	"referencia_id" uuid,
	"monto_esperado_centavos" bigint,
	"archivo_id" uuid NOT NULL,
	"estado" "estado_comprobante" NOT NULL,
	"lectura_ia" jsonb,
	"codigo_revision" text,
	"motivo_revision" text,
	"candidatos" jsonb,
	"mp_pago_id" text,
	"confirmado_por" text,
	"subido_por" text,
	"resuelto_por_admin_id" uuid,
	"motivo_rechazo" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comprobantes_mpPagoId_unique" UNIQUE("mp_pago_id"),
	CONSTRAINT "comprobantes_confirmado_con_entrada" CHECK (("comprobantes"."estado" IN ('VERIFICADO_AUTO', 'CONFIRMADO')) = ("comprobantes"."mp_pago_id" IS NOT NULL)),
	CONSTRAINT "comprobantes_rechazo_con_motivo" CHECK (("comprobantes"."estado" <> 'RECHAZADO') OR ("comprobantes"."motivo_rechazo" IS NOT NULL)),
	CONSTRAINT "comprobantes_monto_esperado_positivo" CHECK ("comprobantes"."monto_esperado_centavos" IS NULL OR "comprobantes"."monto_esperado_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "entradas_mercado_pago" (
	"mp_pago_id" text PRIMARY KEY NOT NULL,
	"e2e_id" text,
	"monto_centavos" bigint NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"cuit_pagador" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entradas_mp_monto_positivo" CHECK ("entradas_mercado_pago"."monto_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_archivo_id_archivos_id_fk" FOREIGN KEY ("archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_mp_pago_id_entradas_mercado_pago_mp_pago_id_fk" FOREIGN KEY ("mp_pago_id") REFERENCES "public"."entradas_mercado_pago"("mp_pago_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_resuelto_por_admin_id_admins_id_fk" FOREIGN KEY ("resuelto_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comprobantes_estado" ON "comprobantes" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "comprobantes_referencia" ON "comprobantes" USING btree ("referencia_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entradas_mp_e2e" ON "entradas_mercado_pago" USING btree ("e2e_id");