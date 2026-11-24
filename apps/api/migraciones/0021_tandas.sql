CREATE TABLE "tandas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo_id" uuid NOT NULL,
	"precio_centavos" bigint NOT NULL,
	"hasta" timestamp with time zone NOT NULL,
	"creada_por_admin_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tandas_precio_positivo" CHECK ("tandas"."precio_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "tandas" ADD CONSTRAINT "tandas_tipo_id_tipos_entrada_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipos_entrada"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tandas" ADD CONSTRAINT "tandas_creada_por_admin_id_admins_id_fk" FOREIGN KEY ("creada_por_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tandas_tipo_hasta" ON "tandas" USING btree ("tipo_id","hasta");--> statement-breakpoint
-- Una tanda no se edita (se quita y se agrega otra). Solo se quita si todavía no terminó.
CREATE FUNCTION tanda_solo_se_quita_si_no_termino() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Una tanda no se cambia: quitala y agregá otra.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.hasta <= now() THEN
    RAISE EXCEPTION 'Una tanda que ya terminó no se quita.' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tandas_protegidas BEFORE UPDATE OR DELETE ON tandas FOR EACH ROW EXECUTE FUNCTION tanda_solo_se_quita_si_no_termino();
