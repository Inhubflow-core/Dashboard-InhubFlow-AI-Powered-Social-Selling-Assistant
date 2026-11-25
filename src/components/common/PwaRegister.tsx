"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

export function PwaRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let refreshing = false;
    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let registrationRef: ServiceWorkerRegistration | null = null;

    const registerSw = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        registrationRef = reg;

        // Si ya hay un SW nuevo esperando al abrir la app
        if (reg.waiting) {
          setWaitingWorker(reg.waiting);
          setDismissed(false);
        }

        // Detectar cuando llega una nueva versión mientras la app está abierta
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(newWorker);
              setDismissed(false);
            }
          });
        });

        // Buscar actualizaciones cada 60s
        intervalId = setInterval(() => {
          reg.update().catch(() => {});
        }, 60_000);
      } catch (err) {
        console.debug("[PWA] Service worker register skipped/failed:", err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && registrationRef) {
        registrationRef.update().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (document.readyState === "complete") {
      registerSw();
    } else {
      window.addEventListener("load", registerSw, { once: true });
    }

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const handleUpdateNow = async () => {
    if (!waitingWorker || isUpdating) return;
    setIsUpdating(true);

    try {
      // Limpiar cachés previas para asegurar carga limpia de los assets nuevos
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}

    waitingWorker.postMessage({ type: "SKIP_WAITING" });

    // Fallback por si controllerchange no se dispara a tiempo
    setTimeout(() => {
      window.location.reload();
    }, 900);
  };

  if (!waitingWorker || dismissed) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[1000000] w-[calc(100%-1.5rem)] max-w-sm animate-in fade-in slide-in-from-top-3 duration-200">
      <div
        className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl shadow-2xl border border-[#0099ff]/35 text-white"
        style={{ background: "rgba(0, 0, 0, 0.94)", backdropFilter: "blur(12px)" }}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate">
            Nueva versión disponible
          </p>
          <p className="text-[11px] text-[#5abaff] truncate">
            Actualiza para ver los últimos cambios
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleUpdateNow}
            disabled={isUpdating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition cursor-pointer disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? "animate-spin" : ""}`} />
            <span>{isUpdating ? "Actualizando..." : "Actualizar"}</span>
          </button>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
