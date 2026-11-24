-- Las transferencias leídas de la cuenta no se borran, y sus datos (número, monto, fecha, quién pagó) no se cambian.
-- Solo cambia cómo se resolvieron.
CREATE FUNCTION transferencia_datos_fijos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mp_pago_id IS DISTINCT FROM OLD.mp_pago_id OR NEW.monto_centavos IS DISTINCT FROM OLD.monto_centavos
     OR NEW.fecha IS DISTINCT FROM OLD.fecha OR NEW.cuit_pagador IS DISTINCT FROM OLD.cuit_pagador
     OR NEW.dni_pagador IS DISTINCT FROM OLD.dni_pagador OR NEW.e2e_id IS DISTINCT FROM OLD.e2e_id THEN
    RAISE EXCEPTION 'Los datos de una transferencia leída de la cuenta no se cambian.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transferencias_datos_fijos BEFORE UPDATE ON transferencias_recibidas
  FOR EACH ROW EXECUTE FUNCTION transferencia_datos_fijos();
--> statement-breakpoint
CREATE TRIGGER transferencias_sin_borrar BEFORE DELETE ON transferencias_recibidas
  FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER transferencias_sin_truncate BEFORE TRUNCATE ON transferencias_recibidas
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
