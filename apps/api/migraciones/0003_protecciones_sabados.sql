-- Protecciones para pagos, gastos y movimientos de la cocina.
-- Ninguno se borra. Lo único que se puede cambiar es pasarlos de CONFIRMADO a ANULADO
-- (con quién, cuándo, por qué y el asiento de anulación). Los montos y datos quedan fijos.

CREATE FUNCTION solo_se_puede_anular() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  campos_de_anulacion text[] := ARRAY['estado', 'anulado_en', 'anulado_por_admin_id', 'motivo_anulacion', 'anulacion_asiento_id', 'actualizado_en'];
BEGIN
  IF (to_jsonb(NEW) - campos_de_anulacion) IS DISTINCT FROM (to_jsonb(OLD) - campos_de_anulacion) THEN
    RAISE EXCEPTION 'En % los datos no se modifican: solo se puede anular el registro.', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estado = 'ANULADO' THEN
    RAISE EXCEPTION 'Este registro de % ya estaba anulado.', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.estado <> 'ANULADO' THEN
    RAISE EXCEPTION 'En % el único cambio permitido es anular.', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pagos_solo_anular BEFORE UPDATE ON pagos FOR EACH ROW EXECUTE FUNCTION solo_se_puede_anular();
--> statement-breakpoint
CREATE TRIGGER pagos_sin_borrar BEFORE DELETE ON pagos FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER pagos_sin_truncate BEFORE TRUNCATE ON pagos FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER gastos_solo_anular BEFORE UPDATE ON gastos FOR EACH ROW EXECUTE FUNCTION solo_se_puede_anular();
--> statement-breakpoint
CREATE TRIGGER gastos_sin_borrar BEFORE DELETE ON gastos FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER gastos_sin_truncate BEFORE TRUNCATE ON gastos FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER movimientos_cocina_solo_anular BEFORE UPDATE ON movimientos_cocina FOR EACH ROW EXECUTE FUNCTION solo_se_puede_anular();
--> statement-breakpoint
CREATE TRIGGER movimientos_cocina_sin_borrar BEFORE DELETE ON movimientos_cocina FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER movimientos_cocina_sin_truncate BEFORE TRUNCATE ON movimientos_cocina FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER gasto_items_inmutables BEFORE UPDATE OR DELETE ON gasto_items FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER gasto_items_sin_truncate BEFORE TRUNCATE ON gasto_items FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER cocinas_sin_borrar BEFORE DELETE ON cocinas FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint

-- El detalle de un gasto tiene que sumar exactamente su total (se verifica al final de la operación).
CREATE FUNCTION verificar_items_de_gasto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  id_gasto uuid;
  total bigint;
  suma bigint;
BEGIN
  IF TG_TABLE_NAME = 'gastos' THEN id_gasto := NEW.id; ELSE id_gasto := NEW.gasto_id; END IF;
  SELECT total_centavos INTO total FROM gastos WHERE id = id_gasto;
  SELECT coalesce(sum(subtotal_centavos), 0) INTO suma FROM gasto_items WHERE gasto_id = id_gasto;
  IF suma <> total THEN
    RAISE EXCEPTION 'Los productos del gasto % suman % centavos y el total es %.', id_gasto, suma, total
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER gasto_items_suman_total AFTER INSERT ON gastos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_items_de_gasto();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER gasto_items_suman_total_items AFTER INSERT ON gasto_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_items_de_gasto();
--> statement-breakpoint

-- Los items solo se agregan a un gasto creado en la misma operación.
CREATE FUNCTION verificar_item_en_gasto_nuevo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  creado_ahora boolean;
BEGIN
  SELECT g.xmin = pg_current_xact_id()::xid INTO creado_ahora FROM gastos g WHERE g.id = NEW.gasto_id;
  IF NOT coalesce(creado_ahora, false) THEN
    RAISE EXCEPTION 'No se pueden agregar productos al gasto %, que ya estaba cerrado.', NEW.gasto_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gasto_item_en_gasto_nuevo BEFORE INSERT ON gasto_items
  FOR EACH ROW EXECUTE FUNCTION verificar_item_en_gasto_nuevo();
