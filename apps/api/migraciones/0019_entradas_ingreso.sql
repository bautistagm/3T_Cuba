ALTER TABLE "entradas" ADD COLUMN "ingreso_id" uuid;--> statement-breakpoint
ALTER TABLE "entradas" ADD COLUMN "ingreso_manual" boolean DEFAULT false NOT NULL;