-- Los controles de caja no se modifican ni se borran.
CREATE TRIGGER controles_caja_inmutables BEFORE UPDATE OR DELETE ON controles_caja FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
CREATE TRIGGER controles_caja_sin_truncate BEFORE TRUNCATE ON controles_caja FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
--> statement-breakpoint
-- Los traspasos no se borran; un traspaso resuelto (confirmado, rechazado o cancelado) ya no cambia.
CREATE FUNCTION traspaso_solo_se_resuelve_una_vez() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El traspaso % ya estaba resuelto.', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.de_admin_id <> OLD.de_admin_id OR NEW.para_admin_id <> OLD.para_admin_id OR NEW.monto_centavos <> OLD.monto_centavos THEN
    RAISE EXCEPTION 'Los datos de un traspaso no se modifican.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER traspasos_resolucion BEFORE UPDATE ON traspasos_efectivo FOR EACH ROW EXECUTE FUNCTION traspaso_solo_se_resuelve_una_vez();
--> statement-breakpoint
CREATE TRIGGER traspasos_sin_borrar BEFORE DELETE ON traspasos_efectivo FOR EACH ROW EXECUTE FUNCTION impedir_cambios();
