"use client";

import { useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useAuth } from "@/context/AuthContext";

const PRESENCE_STORAGE_KEY = "inhubflow_dashboard_presence_v1";

export default function DashboardPresenceTracker() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();
  const searchStr = searchParams?.toString() || "";

  const sendPresence = useCallback(() => {
    if (typeof window === "undefined") return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const bodyPayload = {
      userId: currentUser?.id,
      userEmail: currentUser?.email,
      userName: currentUser?.name,
      pathname,
      search: searchStr,
      visibilityState: typeof document !== "undefined" ? document.visibilityState : "visible",
    };

    try {
      window.localStorage.setItem(
        PRESENCE_STORAGE_KEY,
        JSON.stringify({ ...bodyPayload, updatedAt: new Date().toISOString() })
      );
    } catch {}

    fetch("/api/bot/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
      keepalive: true,
    }).catch(() => {});
  }, [pathname, searchStr, currentUser?.id, currentUser?.email, currentUser?.name]);

  useEffect(() => {
    sendPresence();

    const onFocusOrVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        sendPresence();
      }
    };

    const heartbeat = setInterval(onFocusOrVisible, 35000);
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [sendPresence]);

  return null;
}
