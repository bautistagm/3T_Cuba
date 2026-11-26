-- Eliminar un mes de cuotas (decisión del dueño, 26/11/2026): el mes y sus cuotas se borran solo dentro de la
-- operación "eliminar mes". Antes, los pagos se reacomodan (las otras cuotas que pagaban quedan pagadas).
CREATE FUNCTION borrar_solo_al_eliminar_mes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pid text;
BEGIN
  pid := CASE WHEN TG_TABLE_NAME = 'periodos_cuota' THEN OLD.id::text ELSE to_jsonb(OLD)->>'periodo_id' END;
  IF pid IS NOT NULL AND 'mes:' || pid = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Esto no se borra (solo eliminando el mes completo).' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
DROP TRIGGER periodos_sin_borrar ON periodos_cuota;
--> statement-breakpoint
CREATE TRIGGER periodos_sin_borrar BEFORE DELETE ON periodos_cuota FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_mes();
--> statement-breakpoint
DROP TRIGGER cargos_sin_borrar ON cargos;
--> statement-breakpoint
CREATE TRIGGER cargos_sin_borrar BEFORE DELETE ON cargos FOR EACH ROW EXECUTE FUNCTION borrar_solo_al_eliminar_mes();
