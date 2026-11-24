-- Puerta (etapa 9.3): solo una entrada pagada (VALIDA) se puede marcar como usada,
-- y una vez usada, la hora, quién la marcó y cómo no se cambian.
CREATE OR REPLACE FUNCTION entrada_transicion_valida() RETURNS trigger
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
  IF NEW.estado = 'USADA' AND OLD.estado NOT IN ('VALIDA', 'USADA') THEN
    RAISE EXCEPTION 'Solo una entrada pagada puede entrar.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estado = 'USADA' AND (NEW.usada_en IS DISTINCT FROM OLD.usada_en OR NEW.usada_por IS DISTINCT FROM OLD.usada_por
      OR NEW.ingreso_id IS DISTINCT FROM OLD.ingreso_id OR NEW.ingreso_manual IS DISTINCT FROM OLD.ingreso_manual) THEN
    RAISE EXCEPTION 'El ingreso de una entrada no se cambia.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
