CREATE TYPE "public"."estado_venta_puerta" AS ENUM('A_RENDIR', 'RENDIDA');--> statement-breakpoint
CREATE TABLE "ventas_puerta" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fiesta_id" uuid NOT NULL,
	"tipo_id" uuid NOT NULL,
	"cantidad" integer NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"cobrado_por" text NOT NULL,
	"cobrado_en" timestamp with time zone NOT NULL,
	"asiento_id" uuid NOT NULL,
	"estado" "estado_venta_puerta" DEFAULT 'A_RENDIR' NOT NULL,
	"rendida_en" timestamp with time zone,
	"rendida_a_admin_id" uuid,
	"rendicion_asiento_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ventas_puerta_asientoId_unique" UNIQUE("asiento_id"),
	CONSTRAINT "ventas_puerta_cantidad" CHECK ("ventas_puerta"."cantidad" BETWEEN 1 AND 50),
	CONSTRAINT "ventas_puerta_monto_positivo" CHECK ("ventas_puerta"."monto_centavos" > 0),
	CONSTRAINT "ventas_puerta_rendida_coherente" CHECK (("ventas_puerta"."estado" = 'RENDIDA') = ("ventas_puerta"."rendida_en" IS NOT NULL AND "ventas_puerta"."rendida_a_admin_id" IS NOT NULL AND "ventas_puerta"."rendicion_asiento_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "ventas_puerta" ADD CONSTRAINT "ventas_puerta_fiesta_id_fiestas_id_fk" FOREIGN KEY ("fiesta_id") REFERENCES "public"."fiestas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_puerta" ADD CONSTRAINT "ventas_puerta_tipo_id_tipos_entrada_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipos_entrada"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_puerta" ADD CONSTRAINT "ventas_puerta_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_puerta" ADD CONSTRAINT "ventas_puerta_rendida_a_admin_id_admins_id_fk" FOREIGN KEY ("rendida_a_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_puerta" ADD CONSTRAINT "ventas_puerta_rendicion_asiento_id_asientos_caja_id_fk" FOREIGN KEY ("rendicion_asiento_id") REFERENCES "public"."asientos_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ventas_puerta_fiesta" ON "ventas_puerta" USING btree ("fiesta_id");--> statement-breakpoint
-- Un cobro en la puerta no se cambia (solo se rinde una vez) y no se borra salvo con «Eliminar» del dueño.
CREATE FUNCTION venta_puerta_solo_rendir() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['estado', 'rendida_en', 'rendida_a_admin_id', 'rendicion_asiento_id', 'actualizado_en'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'rendida_en', 'rendida_a_admin_id', 'rendicion_asiento_id', 'actualizado_en']) THEN
    RAISE EXCEPTION 'Un cobro en la puerta no se cambia.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estado = 'RENDIDA' THEN
    RAISE EXCEPTION 'Ese cobro ya se entregó.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ventas_puerta_solo_rendir BEFORE UPDATE ON ventas_puerta FOR EACH ROW EXECUTE FUNCTION venta_puerta_solo_rendir();
--> statement-breakpoint
CREATE TRIGGER ventas_puerta_sin_borrar BEFORE DELETE ON ventas_puerta FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_fiesta();
