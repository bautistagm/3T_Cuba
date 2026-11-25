-- Eliminar un sábado (decisión del dueño, 25/11/2026): el sábado, su cocina, sus movimientos, gastos y cobros se
-- borran, pero solo dentro de la operación "eliminar sábado". Antes, la plata se reacomoda con asientos nuevos;
-- los asientos de caja nunca se borran.
CREATE FUNCTION borrar_solo_al_eliminar_sabado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid text;
BEGIN
  IF TG_TABLE_NAME = 'sabados' THEN
    sid := OLD.id::text;
  ELSIF TG_TABLE_NAME = 'movimientos_cocina' THEN
    SELECT sabado_id::text INTO sid FROM cocinas WHERE id = OLD.cocina_id;
  ELSE
    sid := to_jsonb(OLD)->>'sabado_id';
  END IF;
  IF sid IS NOT NULL AND 'sabado:' || sid = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Esto no se borra (solo eliminando el sábado completo).' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
DROP TRIGGER pagos_sin_borrar ON pagos;
--> statement-breakpoint
CREATE TRIGGER pagos_sin_borrar BEFORE DELETE ON pagos FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_sabado();
--> statement-breakpoint
DROP TRIGGER movimientos_cocina_sin_borrar ON movimientos_cocina;
--> statement-breakpoint
CREATE TRIGGER movimientos_cocina_sin_borrar BEFORE DELETE ON movimientos_cocina FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_sabado();
--> statement-breakpoint
DROP TRIGGER cocinas_sin_borrar ON cocinas;
--> statement-breakpoint
CREATE TRIGGER cocinas_sin_borrar BEFORE DELETE ON cocinas FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_sabado();
--> statement-breakpoint
-- Los gastos de un sábado se borran también con "eliminar sábado".
CREATE OR REPLACE FUNCTION borrar_solo_al_eliminar_gasto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  gid text;
  sid text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Esto no se cambia.' USING ERRCODE = 'P0001';
  END IF;
  gid := CASE WHEN TG_TABLE_NAME = 'gastos' THEN OLD.id::text ELSE to_jsonb(OLD)->>'gasto_id' END;
  IF gid IS NOT NULL AND 'gasto:' || gid = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  SELECT coalesce(g.sabado_id, c.sabado_id)::text INTO sid FROM gastos g LEFT JOIN cocinas c ON c.id = g.cocina_id WHERE g.id = gid::uuid;
  IF sid IS NOT NULL AND 'sabado:' || sid = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Un gasto no se borra (solo con «Eliminar» del dueño).' USING ERRCODE = 'P0001';
END;
$$;
