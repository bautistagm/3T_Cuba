-- Protecciones de la base de datos para la plata y la auditoría.
-- Estas reglas viven en la base (no solo en el código) para que ni un error de programación
-- ni alguien con acceso directo a la base pueda romperlas sin que quede en evidencia.

-- 1) Los registros de caja y de auditoría no se modifican ni se borran nunca.
CREATE FUNCTION impedir_cambios() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % no admite %: los registros de plata y auditoría no se modifican ni se borran. Para corregir, se anula.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER movimientos_inmutables BEFORE UPDATE OR DELETE ON movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER movimientos_sin_truncate BEFORE TRUNCATE ON movimientos_caja
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER asientos_inmutables BEFORE UPDATE OR DELETE ON asientos_caja
  FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER asientos_sin_truncate BEFORE TRUNCATE ON asientos_caja
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER auditoria_sin_truncate BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint

-- 2) Los movimientos solo se agregan a un asiento creado en la misma operación.
--    Así nadie puede "colgar" movimientos nuevos de un asiento viejo.
CREATE FUNCTION verificar_movimiento_en_asiento_nuevo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  creado_en_esta_operacion boolean;
BEGIN
  SELECT a.xmin = pg_current_xact_id()::xid INTO creado_en_esta_operacion
  FROM asientos_caja a WHERE a.id = NEW.asiento_id;
  IF NOT coalesce(creado_en_esta_operacion, false) THEN
    RAISE EXCEPTION 'No se pueden agregar movimientos al asiento %, que ya estaba cerrado.', NEW.asiento_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER movimiento_en_asiento_nuevo BEFORE INSERT ON movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION verificar_movimiento_en_asiento_nuevo();
--> statement-breakpoint

-- 3) Cada asiento tiene al menos dos movimientos y suman exactamente cero (doble partida).
--    Se verifica al final de la operación (DEFERRED), cuando ya se cargaron todos los movimientos.
CREATE FUNCTION verificar_asiento_balanceado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  id_asiento uuid;
  suma bigint;
  cantidad integer;
BEGIN
  IF TG_TABLE_NAME = 'asientos_caja' THEN
    id_asiento := NEW.id;
  ELSE
    id_asiento := NEW.asiento_id;
  END IF;

  SELECT coalesce(sum(monto_centavos), 0), count(*) INTO suma, cantidad
  FROM movimientos_caja WHERE asiento_id = id_asiento;

  IF cantidad < 2 THEN
    RAISE EXCEPTION 'El asiento % tiene que tener al menos dos movimientos (tiene %).', id_asiento, cantidad
      USING ERRCODE = 'P0001';
  END IF;
  IF suma <> 0 THEN
    RAISE EXCEPTION 'El asiento % no está balanceado: sus movimientos suman % centavos y tienen que sumar 0.', id_asiento, suma
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER asiento_balanceado AFTER INSERT ON asientos_caja
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_asiento_balanceado();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER movimiento_balanceado AFTER INSERT ON movimientos_caja
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_asiento_balanceado();
--> statement-breakpoint

-- 4) Una anulación es exactamente el espejo del asiento que anula: mismas cuentas, montos opuestos.
--    Y una anulación no se puede anular (para revertirla, se carga de nuevo el movimiento original).
CREATE FUNCTION verificar_anulacion_espejo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  diferencias integer;
  original_es_anulacion boolean;
BEGIN
  IF NEW.anula_asiento_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT origen = 'ANULACION' INTO original_es_anulacion
  FROM asientos_caja WHERE id = NEW.anula_asiento_id;
  IF original_es_anulacion THEN
    RAISE EXCEPTION 'No se puede anular una anulación (asiento %).', NEW.anula_asiento_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO diferencias
  FROM (
    SELECT cuenta_id, sum(monto_centavos) AS total
    FROM movimientos_caja WHERE asiento_id = NEW.id GROUP BY cuenta_id
  ) AS anulacion
  FULL OUTER JOIN (
    SELECT cuenta_id, -sum(monto_centavos) AS total
    FROM movimientos_caja WHERE asiento_id = NEW.anula_asiento_id GROUP BY cuenta_id
  ) AS original USING (cuenta_id)
  WHERE anulacion.total IS DISTINCT FROM original.total;

  IF diferencias > 0 THEN
    RAISE EXCEPTION 'El asiento % no es el espejo exacto del asiento % que dice anular.', NEW.id, NEW.anula_asiento_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER anulacion_espejo AFTER INSERT ON asientos_caja
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_anulacion_espejo();
