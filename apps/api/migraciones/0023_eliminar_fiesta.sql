-- Eliminar una fiesta (decisión del dueño, 24/11/2026): sus datos se borran del todo, pero solo dentro de
-- la operación "eliminar fiesta", que marca en la transacción qué fiesta se está borrando.
-- La plata no se borra: antes, cada pago se anula (asiento espejo) y la plata se devuelve o pasa a "Otro ingreso".
CREATE FUNCTION borrar_solo_al_eliminar_fiesta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fid text;
BEGIN
  IF TG_TABLE_NAME = 'fiestas' THEN
    fid := OLD.id::text;
  ELSIF TG_TABLE_NAME = 'tandas' THEN
    SELECT fiesta_id::text INTO fid FROM tipos_entrada WHERE id = OLD.tipo_id;
  ELSE
    fid := to_jsonb(OLD)->>'fiesta_id';
  END IF;
  IF fid IS NOT NULL AND fid = current_setting('app.eliminando_fiesta', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Estos datos no se borran (solo al eliminar la fiesta completa).' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
DROP TRIGGER fiestas_sin_borrar ON fiestas;
--> statement-breakpoint
CREATE TRIGGER fiestas_sin_borrar BEFORE DELETE ON fiestas FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_fiesta();
--> statement-breakpoint
DROP TRIGGER tipos_entrada_sin_borrar ON tipos_entrada;
--> statement-breakpoint
CREATE TRIGGER tipos_entrada_sin_borrar BEFORE DELETE ON tipos_entrada FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_fiesta();
--> statement-breakpoint
DROP TRIGGER compras_entradas_sin_borrar ON compras_entradas;
--> statement-breakpoint
CREATE TRIGGER compras_entradas_sin_borrar BEFORE DELETE ON compras_entradas FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_fiesta();
--> statement-breakpoint
DROP TRIGGER entradas_sin_borrar ON entradas;
--> statement-breakpoint
CREATE TRIGGER entradas_sin_borrar BEFORE DELETE ON entradas FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_fiesta();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tanda_solo_se_quita_si_no_termino() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fid text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Una tanda no se cambia: quitala y agregá otra.' USING ERRCODE = 'P0001';
  END IF;
  SELECT fiesta_id::text INTO fid FROM tipos_entrada WHERE id = OLD.tipo_id;
  IF OLD.hasta <= now() AND fid IS DISTINCT FROM current_setting('app.eliminando_fiesta', true) THEN
    RAISE EXCEPTION 'Una tanda que ya terminó no se quita.' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
