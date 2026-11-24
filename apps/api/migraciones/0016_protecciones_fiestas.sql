-- Las fiestas, compras y entradas no se borran (la plata nunca se borra: se anula).
-- Una entrada usada o anulada queda así. Una compra pagada o anulada no vuelve atrás.
CREATE TRIGGER fiestas_sin_borrar BEFORE DELETE ON fiestas FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER tipos_entrada_sin_borrar BEFORE DELETE ON tipos_entrada FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER compras_entradas_sin_borrar BEFORE DELETE ON compras_entradas FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER entradas_sin_borrar BEFORE DELETE ON entradas FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE FUNCTION entrada_transicion_valida() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo OR NEW.compra_id IS DISTINCT FROM OLD.compra_id OR NEW.dni IS DISTINCT FROM OLD.dni OR NEW.tipo_id IS DISTINCT FROM OLD.tipo_id THEN
    RAISE EXCEPTION 'El código, la compra, el tipo y el DNI de una entrada no se cambian.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estado = 'ANULADA' AND NEW.estado <> 'ANULADA' THEN
    RAISE EXCEPTION 'Una entrada anulada no se puede volver a usar.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estado = 'USADA' AND NEW.estado NOT IN ('USADA', 'ANULADA') THEN
    RAISE EXCEPTION 'Una entrada usada no vuelve atrás.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entradas_transicion_valida BEFORE UPDATE ON entradas FOR EACH ROW EXECUTE FUNCTION entrada_transicion_valida();
--> statement-breakpoint
CREATE FUNCTION compra_transicion_valida() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_centavos IS DISTINCT FROM OLD.total_centavos OR NEW.dni_pagador IS DISTINCT FROM OLD.dni_pagador OR NEW.cantidad IS DISTINCT FROM OLD.cantidad THEN
    RAISE EXCEPTION 'El total, la cantidad y el DNI de una compra no se cambian.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'Una compra anulada no se puede cambiar.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER compras_transicion_valida BEFORE UPDATE ON compras_entradas FOR EACH ROW EXECUTE FUNCTION compra_transicion_valida();
