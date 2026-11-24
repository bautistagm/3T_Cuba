-- Protecciones de cuotas.
-- Los meses abiertos y las cuotas de cada jugador no se borran.
-- Una cuota anulada queda así. El jugador y el mes de una cuota no se cambian.
-- Un pago de cuotas confirmado tiene que sumar exactamente lo que cancela.

CREATE TRIGGER periodos_sin_borrar BEFORE DELETE ON periodos_cuota FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER periodos_sin_truncate BEFORE TRUNCATE ON periodos_cuota FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER cargos_sin_borrar BEFORE DELETE ON cargos FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER cargos_sin_truncate BEFORE TRUNCATE ON cargos FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE FUNCTION cargo_cambios_validos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.jugador_id IS DISTINCT FROM OLD.jugador_id OR NEW.periodo_id IS DISTINCT FROM OLD.periodo_id THEN
    RAISE EXCEPTION 'El jugador y el mes de una cuota no se cambian.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estado = 'ANULADO' THEN
    RAISE EXCEPTION 'Esta cuota está anulada y ya no se puede cambiar.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.monto_centavos IS DISTINCT FROM OLD.monto_centavos AND (OLD.estado <> 'PENDIENTE' OR NEW.estado <> 'PENDIENTE') THEN
    RAISE EXCEPTION 'El monto de una cuota solo se cambia mientras está pendiente.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cargos_cambios_validos BEFORE UPDATE ON cargos FOR EACH ROW EXECUTE FUNCTION cargo_cambios_validos();
--> statement-breakpoint
CREATE FUNCTION verificar_pago_cuota(p_pago uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_pago pagos%ROWTYPE;
  v_suma bigint;
BEGIN
  IF p_pago IS NULL THEN RETURN; END IF;
  SELECT * INTO v_pago FROM pagos WHERE id = p_pago;
  IF NOT FOUND OR v_pago.origen <> 'CUOTA' THEN RETURN; END IF;
  SELECT coalesce(sum(monto_centavos), 0) INTO v_suma FROM cargos WHERE pago_id = p_pago;
  IF v_pago.estado = 'CONFIRMADO' AND v_suma <> v_pago.monto_centavos THEN
    RAISE EXCEPTION 'El pago de cuotas % no coincide con las cuotas que cancela (% contra %).', p_pago, v_pago.monto_centavos, v_suma
      USING ERRCODE = 'P0001';
  END IF;
  IF v_pago.estado = 'ANULADO' AND v_suma <> 0 THEN
    RAISE EXCEPTION 'El pago % está anulado pero todavía cancela cuotas.', p_pago USING ERRCODE = 'P0001';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION verificar_pago_cuota_desde_cargo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM verificar_pago_cuota(NEW.pago_id);
  IF TG_OP = 'UPDATE' AND OLD.pago_id IS DISTINCT FROM NEW.pago_id THEN
    PERFORM verificar_pago_cuota(OLD.pago_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cargos_pago_cuadra AFTER INSERT OR UPDATE ON cargos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_pago_cuota_desde_cargo();
--> statement-breakpoint
CREATE FUNCTION verificar_pago_cuota_desde_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM verificar_pago_cuota(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pagos_cuota_cuadra AFTER INSERT OR UPDATE ON pagos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_pago_cuota_desde_pago();
