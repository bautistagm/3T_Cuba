CREATE TYPE "public"."estado_compra_entradas" AS ENUM('PENDIENTE_PAGO', 'PAGADA', 'ANULADA');--> statement-breakpoint
CREATE TYPE "public"."estado_entrada" AS ENUM('PENDIENTE_PAGO', 'VALIDA', 'USADA', 'ANULADA');--> statement-breakpoint
CREATE TYPE "public"."estado_fiesta" AS ENUM('A_LA_VENTA', 'VENTA_CERRADA');--> statement-breakpoint
CREATE TABLE "compras_entradas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fiesta_id" uuid NOT NULL,
	"tipo_id" uuid NOT NULL,
	"dni_pagador" text NOT NULL,
	"email" text NOT NULL,
	"telefono" text,
	"cantidad" integer NOT NULL,
	"precio_unitario_centavos" bigint NOT NULL,
	"total_centavos" bigint NOT NULL,
	"estado" "estado_compra_entradas" DEFAULT 'PENDIENTE_PAGO' NOT NULL,
	"pago_id" uuid,
	"codigo_consulta" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compras_entradas_pagoId_unique" UNIQUE("pago_id"),
	CONSTRAINT "compras_entradas_codigoConsulta_unique" UNIQUE("codigo_consulta"),
	CONSTRAINT "compras_cantidad_valida" CHECK ("compras_entradas"."cantidad" BETWEEN 1 AND 10),
	CONSTRAINT "compras_total_cuadra" CHECK ("compras_entradas"."total_centavos" = "compras_entradas"."precio_unitario_centavos" * "compras_entradas"."cantidad"),
	CONSTRAINT "compras_pagada_con_pago" CHECK (("compras_entradas"."estado" <> 'PAGADA') OR ("compras_entradas"."pago_id" IS NOT NULL)),
	CONSTRAINT "compras_pendiente_sin_pago" CHECK (("compras_entradas"."estado" <> 'PENDIENTE_PAGO') OR ("compras_entradas"."pago_id" IS NULL)),
	CONSTRAINT "compras_dni_valido" CHECK ("compras_entradas"."dni_pagador" ~ '^[1-9][0-9]{6,7}$')
);
--> statement-breakpoint
CREATE TABLE "entradas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compra_id" uuid NOT NULL,
	"fiesta_id" uuid NOT NULL,
	"tipo_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"dni" text NOT NULL,
	"codigo" text NOT NULL,
	"estado" "estado_entrada" DEFAULT 'PENDIENTE_PAGO' NOT NULL,
	"usada_en" timestamp with time zone,
	"usada_por" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entradas_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "entradas_usada_con_hora" CHECK (("entradas"."estado" = 'USADA') = ("entradas"."usada_en" IS NOT NULL)),
	CONSTRAINT "entradas_dni_valido" CHECK ("entradas"."dni" ~ '^[1-9][0-9]{6,7}$')
);
--> statement-breakpoint
CREATE TABLE "fiestas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"fecha_hora" timestamp with time zone NOT NULL,
	"lugar" text,
	"estado" "estado_fiesta" DEFAULT 'A_LA_VENTA' NOT NULL,
	"token_puerta" text NOT NULL,
	"creada_por_admin_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiestas_tokenPuerta_unique" UNIQUE("token_puerta")
);
--> statement-breakpoint
CREATE TABLE "tipos_entrada" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fiesta_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"precio_centavos" bigint NOT NULL,
	"token_venta" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tipos_entrada_tokenVenta_unique" UNIQUE("token_venta"),
	CONSTRAINT "tipos_entrada_precio_positivo" CHECK ("tipos_entrada"."precio_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "compras_entradas" ADD CONSTRAINT "compras_entradas_fiesta_id_fiestas_id_fk" FOREIGN KEY ("fiesta_id") REFERENCES "public"."fiestas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_entradas" ADD CONSTRAINT "compras_entradas_tipo_id_tipos_entrada_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipos_entrada"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_entradas" ADD CONSTRAINT "compras_entradas_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_compra_id_compras_entradas_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras_entradas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_fiesta_id_fiestas_id_fk" FOREIGN KEY ("fiesta_id") REFERENCES "public"."fiestas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_tipo_id_tipos_entrada_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipos_entrada"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiestas" ADD CONSTRAINT "fiestas_creada_por_admin_id_admins_id_fk" FOREIGN KEY ("creada_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tipos_entrada" ADD CONSTRAINT "tipos_entrada_fiesta_id_fiestas_id_fk" FOREIGN KEY ("fiesta_id") REFERENCES "public"."fiestas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compras_pendientes_dni" ON "compras_entradas" USING btree ("dni_pagador","estado");--> statement-breakpoint
CREATE INDEX "entradas_fiesta" ON "entradas" USING btree ("fiesta_id","estado");--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_entrada_fiesta_nombre" ON "tipos_entrada" USING btree ("fiesta_id","nombre");