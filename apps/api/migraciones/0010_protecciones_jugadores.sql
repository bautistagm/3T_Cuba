-- Un jugador eliminado (con sus datos personales ya borrados) no se puede volver a cambiar.
CREATE FUNCTION jugador_eliminado_fijo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'ELIMINADO' THEN
    RAISE EXCEPTION 'Este jugador fue eliminado y ya no se puede cambiar.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER jugadores_eliminado_fijo BEFORE UPDATE ON jugadores
  FOR EACH ROW EXECUTE FUNCTION jugador_eliminado_fijo();
--> statement-breakpoint
CREATE TRIGGER jugadores_sin_truncate BEFORE TRUNCATE ON jugadores
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambios();
