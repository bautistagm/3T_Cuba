import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { auditoria, jugadores } from "../db/esquema.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { leerCsv } from "./csv.js";
import {
  analizarImportacion,
  crearJugador,
  darDeBaja,
  datosJugadorSchema,
  editarJugador,
  eliminarJugador,
  importarJugadores,
  jugadorActivoPorDni,
  listarJugadores,
  reactivar,
} from "./jugadores.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
const datos = (cambios: Record<string, string> = {}) =>
  datosJugadorSchema.parse({ nombre: "Juan", apellido: "Pérez", dni: "40.111.222", telefono: "11 5555-1234", email: "Juan@Ejemplo.com", camada: "2005", ...cambios });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan Admin", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("jugadores", () => {
  it("un admin da de alta un jugador; el DNI queda solo con números", async () => {
    const j = await crearJugador(conexion.db, admin, datos());
    expect(j).toMatchObject({ nombre: "Juan", apellido: "Pérez", dni: "40111222", telefono: "1155551234", email: "juan@ejemplo.com", estado: "ACTIVO" });
    expect((await jugadorActivoPorDni(conexion.db, "40111222"))?.id).toBe(j.id);
  });

  it("no deja dos jugadores con el mismo DNI", async () => {
    await expect(crearJugador(conexion.db, admin, datos({ nombre: "Otro", dni: "40111222" }))).rejects.toMatchObject({ codigo: "DNI_REPETIDO" });
  });

  it("valida los datos", () => {
    expect(datosJugadorSchema.safeParse({ nombre: "A", apellido: "B", dni: "123" }).success).toBe(false);
    expect(datosJugadorSchema.safeParse({ nombre: "", apellido: "B", dni: "40111223" }).success).toBe(false);
    expect(datosJugadorSchema.safeParse({ nombre: "A", apellido: "B", dni: "40111223", email: "no-es-mail" }).success).toBe(false);
    expect(datosJugadorSchema.safeParse({ nombre: "A", apellido: "B", dni: "40111223", telefono: "", email: "" }).success).toBe(true);
  });

  it("el admin corrige el teléfono, pero el DNI solo lo cambia el dueño", async () => {
    const j = await crearJugador(conexion.db, admin, datos({ nombre: "Tomás", apellido: "Gómez", dni: "41000001" }));
    const editado = await editarJugador(conexion.db, admin, j.id, { telefono: "1166667777" });
    expect(editado.telefono).toBe("1166667777");
    await expect(editarJugador(conexion.db, admin, j.id, { dni: "41000002" })).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    expect((await editarJugador(conexion.db, dueno, j.id, { dni: "41000002" })).dni).toBe("41000002");
  });

  it("la auditoría dice qué cambió pero no guarda datos personales", async () => {
    const filas = await conexion.db.select().from(auditoria).where(eq(auditoria.entidad, "jugadores"));
    expect(filas.length).toBeGreaterThan(0);
    const todo = JSON.stringify(filas);
    for (const dato of ["40111222", "41000002", "Pérez", "1166667777", "juan@ejemplo.com"]) expect(todo).not.toContain(dato);
    expect(todo).toContain("telefono");
  });

  it("baja y reactivación: solo el dueño; el de baja no cuenta para reconocer transferencias", async () => {
    const j = await crearJugador(conexion.db, admin, datos({ nombre: "Lucas", apellido: "Díaz", dni: "42000001" }));
    await expect(darDeBaja(conexion.db, admin, j.id)).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    expect((await darDeBaja(conexion.db, dueno, j.id)).estado).toBe("BAJA");
    expect(await jugadorActivoPorDni(conexion.db, "42000001")).toBeNull();
    expect((await listarJugadores(conexion.db)).jugadores.some((x) => x.id === j.id)).toBe(false);
    expect((await listarJugadores(conexion.db, { estado: "BAJA" })).jugadores.some((x) => x.id === j.id)).toBe(true);
    expect((await reactivar(conexion.db, dueno, j.id)).estado).toBe("ACTIVO");
  });

  it("busca por nombre, apellido, camada o parte del DNI", async () => {
    expect((await listarJugadores(conexion.db, { buscar: "tomas gomez" })).jugadores).toHaveLength(1); // sin tildes también
    expect((await listarJugadores(conexion.db, { buscar: "GOMEZ TOMAS" })).jugadores).toHaveLength(1);
    expect((await listarJugadores(conexion.db, { buscar: "Gómez" })).jugadores).toHaveLength(1);
    expect((await listarJugadores(conexion.db, { buscar: "41.000" })).jugadores).toHaveLength(1);
    expect((await listarJugadores(conexion.db, { buscar: "2005" })).jugadores.length).toBeGreaterThan(1);
  });

  it("eliminar sin nada asociado lo borra por completo (pide el nombre para confirmar)", async () => {
    const j = await crearJugador(conexion.db, admin, datos({ nombre: "Borrable", apellido: "Uno", dni: "43000001" }));
    await expect(eliminarJugador(conexion.db, admin, j.id, "Borrable Uno")).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await expect(eliminarJugador(conexion.db, dueno, j.id, "Otro Nombre")).rejects.toMatchObject({ codigo: "CONFIRMACION_INCORRECTA" });
    expect(await eliminarJugador(conexion.db, dueno, j.id, "  borrable   UNO ")).toEqual({ borrado: true, anonimizado: false });
    expect(await conexion.db.select().from(jugadores).where(eq(jugadores.id, j.id))).toHaveLength(0);
  });

  it("eliminar con pagos asociados borra sus datos personales y queda como eliminado, para siempre", async () => {
    const j = await crearJugador(conexion.db, admin, datos({ nombre: "Con", apellido: "Pagos", dni: "43000002" }));
    // Simula un pago que apunta al jugador (la tabla de cuotas llega en la etapa 8).
    await conexion.db.execute(sql`CREATE TABLE pagos_de_prueba (jugador_id uuid REFERENCES jugadores(id))`);
    await conexion.db.execute(sql`INSERT INTO pagos_de_prueba VALUES (${j.id})`);
    expect(await eliminarJugador(conexion.db, dueno, j.id, "Con Pagos")).toEqual({ borrado: false, anonimizado: true });
    const [queda] = await conexion.db.select().from(jugadores).where(eq(jugadores.id, j.id));
    expect(queda).toMatchObject({ estado: "ELIMINADO", nombre: null, apellido: null, dni: null, telefono: null, email: null });
    await expect(conexion.db.update(jugadores).set({ estado: "ACTIVO" }).where(eq(jugadores.id, j.id))).rejects.toThrow();
    // El DNI quedó libre: si vuelve, se lo puede dar de alta de nuevo.
    expect((await crearJugador(conexion.db, admin, datos({ nombre: "Con", apellido: "Pagos", dni: "43000002" }))).dni).toBe("43000002");
  });
});

const csvDelFormulario = [
  "Marca temporal,Nombre,Apellido,DNI (sin puntos),Celular (WhatsApp),Dirección de correo electrónico,Camada",
  '24/11/2026 10:00:00,Mateo,Fernández,44.000.001,11 2222-3333,mateo@ejemplo.com,2006',
  '24/11/2026 10:01:00,"Juan Ignacio","De la Torre",44000002,,,2006',
  "24/11/2026 10:02:00,Ya,Cargado,40111222,,,2005",
  "24/11/2026 10:03:00,Sin,Dni,,,,2006",
  "24/11/2026 10:04:00,Repetido,Enarchivo,44.000.001,,,2006",
  "24/11/2026 10:05:00,Mail,Malo,44000003,,no-es-un-mail,2007",
].join("\n");

describe("importación desde el Formulario de Google", () => {
  it("lee CSV con comillas, comas, punto y coma y saltos de línea", () => {
    expect(leerCsv('a,b\n"x, y","con ""comillas"""\n')).toEqual([["a", "b"], ["x, y", 'con "comillas"']]);
    expect(leerCsv("a;b\r\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(leerCsv('a,b\n"línea\nnueva",2')).toEqual([["a", "b"], ["línea\nnueva", "2"]]);
  });

  it("muestra qué va a pasar con cada fila antes de importar", async () => {
    const r = await analizarImportacion(conexion.db, csvDelFormulario);
    expect(r.resumen).toEqual({ nuevos: 2, yaEstan: 1, conError: 3 });
    expect(r.filas.map((f) => `${f.fila}:${f.estado}`)).toEqual(["2:NUEVO", "3:NUEVO", "4:YA_ESTA", "5:ERROR", "6:ERROR", "7:ERROR"]);
    expect(r.filas[4]?.motivo).toContain("fila 2");
    expect(r.columnasReconocidas.sort()).toEqual(["apellido", "camada", "dni", "email", "nombre", "telefono"]);
  });

  it("si faltan preguntas en el formulario, lo explica", async () => {
    await expect(analizarImportacion(conexion.db, "Nombre y apellido,DNI\nJuan Pérez,40000000")).rejects.toMatchObject({ codigo: "FALTAN_COLUMNAS" });
  });

  it("importa solo los nuevos; solo el dueño; repetir no duplica", async () => {
    await expect(importarJugadores(conexion.db, admin, csvDelFormulario)).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    expect((await importarJugadores(conexion.db, dueno, csvDelFormulario)).importados).toBe(2);
    expect((await jugadorActivoPorDni(conexion.db, "44000002"))?.apellido).toBe("De la Torre");
    expect((await importarJugadores(conexion.db, dueno, csvDelFormulario)).importados).toBe(0);
  });
});
