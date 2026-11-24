CREATE TYPE "public"."estado_jugador" AS ENUM('ACTIVO', 'BAJA', 'ELIMINADO');--> statement-breakpoint
CREATE TABLE "jugadores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text,
	"apellido" text,
	"dni" text,
	"telefono" text,
	"email" text,
	"camada" text,
	"estado" "estado_jugador" DEFAULT 'ACTIVO' NOT NULL,
	"baja_en" timestamp with time zone,
	"eliminado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jugadores_datos_segun_estado" CHECK (CASE WHEN "jugadores"."estado" = 'ELIMINADO'
        THEN "jugadores"."nombre" IS NULL AND "jugadores"."apellido" IS NULL AND "jugadores"."dni" IS NULL AND "jugadores"."telefono" IS NULL AND "jugadores"."email" IS NULL AND "jugadores"."eliminado_en" IS NOT NULL
        ELSE "jugadores"."nombre" IS NOT NULL AND "jugadores"."apellido" IS NOT NULL AND "jugadores"."dni" IS NOT NULL END),
	CONSTRAINT "jugadores_dni_valido" CHECK ("jugadores"."dni" IS NULL OR "jugadores"."dni" ~ '^[1-9][0-9]{6,7}$'),
	CONSTRAINT "jugadores_baja_con_fecha" CHECK (("jugadores"."estado" = 'BAJA') = ("jugadores"."baja_en" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jugadores_dni" ON "jugadores" USING btree ("dni");--> statement-breakpoint
CREATE INDEX "jugadores_estado" ON "jugadores" USING btree ("estado");