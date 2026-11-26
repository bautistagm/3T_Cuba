-- Lápiz y X en todo (decisión del dueño, 26/11/2026): además de borrar un sábado, un mes o una fiesta entera,
-- se puede borrar un registro suelto, pero solo dentro de la operación que lo elimina o lo edita, que marca en la
-- transacción qué registro es ('tabla:id'). Antes, la plata se reacomoda con asientos nuevos.
CREATE OR REPLACE FUNCTION borrar_solo_al_eliminar_sabado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid text;
BEGIN
  IF TG_TABLE_NAME || ':' || OLD.id::text = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'sabados' THEN
    sid := OLD.id::text;
  ELSIF TG_TABLE_NAME = 'movimientos_cocina' THEN
    SELECT sabado_id::text INTO sid FROM cocinas WHERE id = OLD.cocina_id;
  ELSE
    sid := to_jsonb(OLD)->>'sabado_id';
  END IF;
  IF sid IS NOT NULL AND 'sabado:' || sid = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Esto no se borra (solo con «Eliminar» del dueño).' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION borrar_solo_al_eliminar_mes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pid text;
BEGIN
  IF TG_TABLE_NAME || ':' || OLD.id::text = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  pid := CASE WHEN TG_TABLE_NAME = 'periodos_cuota' THEN OLD.id::text ELSE to_jsonb(OLD)->>'periodo_id' END;
  IF pid IS NOT NULL AND 'mes:' || pid = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Esto no se borra (solo con «Eliminar» del dueño).' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION borrar_solo_al_eliminar_fiesta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fid text;
BEGIN
  IF TG_TABLE_NAME || ':' || OLD.id::text = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  -- Al eliminar una compra se borran también sus entradas.
  IF TG_TABLE_NAME = 'entradas' AND 'compras_entradas:' || OLD.compra_id::text = current_setting('app.eliminando', true) THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'fiestas' THEN
    fid := OLD.id::text;
  ELSIF TG_TABLE_NAME = 'tandas' THEN
    SELECT fiesta_id::text INTO fid FROM tipos_entrada WHERE id = OLD.tipo_id;
  ELSE
    fid := to_jsonb(OLD)->>'fiesta_id';
  END IF;
  IF fid IS NOT NULL AND fid = current_setting('app.eliminando_fiesta', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Estos datos no se borran (solo con «Eliminar» del dueño).' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
-- El DNI de una entrada solo lo cambia el dueño con el lápiz.
CREATE OR REPLACE FUNCTION entrada_transicion_valida() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo OR NEW.compra_id IS DISTINCT FROM OLD.compra_id OR NEW.tipo_id IS DISTINCT FROM OLD.tipo_id THEN
    RAISE EXCEPTION 'El código, la compra y el tipo de una entrada no se cambian.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.dni IS DISTINCT FROM OLD.dni AND 'entradas:' || OLD.id::text IS DISTINCT FROM current_setting('app.editando', true) THEN
    RAISE EXCEPTION 'El DNI de una entrada solo lo cambia el dueño.' USING ERRCODE = 'P0001';
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
