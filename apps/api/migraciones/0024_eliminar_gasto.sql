-- Eliminar un gasto (decisión del dueño, 25/11/2026): el gasto y su detalle se borran, pero solo dentro de la
-- operación "eliminar gasto". Antes, la plata se reacomoda: vuelve a la caja (asiento espejo) o queda como otro gasto.
CREATE FUNCTION borrar_solo_al_eliminar_gasto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  gid text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Esto no se cambia.' USING ERRCODE = 'P0001';
  END IF;
  gid := CASE WHEN TG_TABLE_NAME = 'gastos' THEN OLD.id::text ELSE to_jsonb(OLD)->>'gasto_id' END;
  IF gid IS NOT NULL AND 'gasto:' || gid = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Un gasto no se borra (solo con «Eliminar» del dueño).' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
DROP TRIGGER gastos_sin_borrar ON gastos;
--> statement-breakpoint
CREATE TRIGGER gastos_sin_borrar BEFORE DELETE ON gastos FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_gasto();
--> statement-breakpoint
DROP TRIGGER gasto_items_inmutables ON gasto_items;
--> statement-breakpoint
CREATE TRIGGER gasto_items_inmutables BEFORE UPDATE OR DELETE ON gasto_items FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_gasto();
