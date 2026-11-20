import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ErrorApi, type Admin } from "./api";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "sin-conexion"; mensaje: string }
  | { tipo: "instalacion"; habilitada: boolean }
  | { tipo: "sin-sesion" }
  | { tipo: "con-sesion"; admin: Admin };

interface ContextoSesion {
  estado: Estado;
  entrar: (admin: Admin) => void;
  salir: () => Promise<void>;
  reintentar: () => void;
}

const Contexto = createContext<ContextoSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  const cargar = useCallback(async () => {
    setEstado({ tipo: "cargando" });
    try {
      const instalacion = await api.estadoInstalacion();
      if (instalacion.necesitaDueno) {
        setEstado({ tipo: "instalacion", habilitada: instalacion.habilitada });
        return;
      }
      const { admin } = await api.yo();
      setEstado({ tipo: "con-sesion", admin });
    } catch (error) {
      if (error instanceof ErrorApi && error.estado === 401) setEstado({ tipo: "sin-sesion" });
      else setEstado({ tipo: "sin-conexion", mensaje: error instanceof Error ? error.message : "Sin conexión." });
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const valor = useMemo<ContextoSesion>(
    () => ({
      estado,
      entrar: (admin) => setEstado({ tipo: "con-sesion", admin }),
      salir: async () => {
        await api.logout().catch(() => undefined);
        setEstado({ tipo: "sin-sesion" });
      },
      reintentar: () => void cargar(),
    }),
    [estado, cargar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ContextoSesion {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error("useSesion fuera de ProveedorSesion");
  return contexto;
}

export function useAdmin(): Admin {
  const { estado } = useSesion();
  if (estado.tipo !== "con-sesion") throw new Error("No hay sesión");
  return estado.admin;
}
