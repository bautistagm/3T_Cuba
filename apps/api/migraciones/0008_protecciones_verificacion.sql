-- Protecciones de la verificación de transferencias.
-- Las entradas de Mercado Pago usadas no se cambian ni se borran: así un movimiento nunca confirma dos pagos.
-- Un comprobante no se borra, y una vez resuelto (verificado, confirmado o rechazado) queda fijo.

CREATE TRIGGER entradas_mp_inmutables BEFORE UPDATE OR DELETE ON entradas_mercado_pago
  FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER entradas_mp_sin_truncate BEFORE TRUNCATE ON entradas_mercado_pago
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE FUNCTION comprobante_solo_se_resuelve() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  campos_fijos text[] := ARRAY['id', 'destino', 'referencia_id', 'monto_esperado_centavos', 'archivo_id', 'lectura_ia', 'subido_por', 'creado_en'];
  campo text;
BEGIN
  IF OLD.estado <> 'REVISAR' THEN
    RAISE EXCEPTION 'Este comprobante ya está resuelto y no se puede cambiar.' USING ERRCODE = 'P0001';
  END IF;
  FOREACH campo IN ARRAY campos_fijos LOOP
    IF (to_jsonb(NEW) -> campo) IS DISTINCT FROM (to_jsonb(OLD) -> campo) THEN
      RAISE EXCEPTION 'En un comprobante no se puede cambiar %.', campo USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER comprobantes_solo_resolver BEFORE UPDATE ON comprobantes
  FOR EACH ROW EXECUTE FUNCTION comprobante_solo_se_resuelve();
--> statement-breakpoint
CREATE TRIGGER comprobantes_sin_borrar BEFORE DELETE ON comprobantes
  FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER comprobantes_sin_truncate BEFORE TRUNCATE ON comprobantes
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
-- Toda entrada guardada tiene que estar confirmando un comprobante al terminar la transacción.
CREATE FUNCTION entrada_mp_con_comprobante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM comprobantes WHERE mp_pago_id = NEW.mp_pago_id) THEN
    RAISE EXCEPTION 'La entrada de Mercado Pago % se guardó sin un comprobante que la use.', NEW.mp_pago_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entrada_mp_usada AFTER INSERT ON entradas_mercado_pago
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION entrada_mp_con_comprobante();
