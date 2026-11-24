"use client";

import React, { useState, useEffect } from "react";
import {
  Download,
  Smartphone,
  X,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";

export function InstallBotAppButton() {
  const t = useTranslations("header.botApp");
  const [isOpen, setIsOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [appUrl, setAppUrl] = useState<string>("/bot");
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const fullUrl = `${window.location.origin}/bot`;
      setAppUrl(fullUrl);

      QRCode.toDataURL(fullUrl, {
        width: 190,
        margin: 1,
        color: {
          dark: "#0a0f1d",
          light: "#ffffff",
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch(() => {});

      // Check if already in standalone PWA mode
      if (
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone
      ) {
        setIsInstalled(true);
      }

      const handleBeforeInstall = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstall);

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") {
          setIsInstalled(true);
          setIsOpen(false);
        }
        setDeferredPrompt(null);
      } catch {
        setIsOpen(true);
      }
    } else {
      setIsOpen(true);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#0099ff]/15 to-[#0099ff]/25 hover:from-[#0099ff]/25 hover:to-[#0099ff]/35 text-[#0099ff] border border-[#0099ff]/30 text-xs font-medium transition shadow-sm"
        title={t("buttonTitle")}
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t("button")}</span>
        <span className="sm:hidden">{t("buttonShort")}</span>
      </button>

      {/* Modal Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-[#0f172a] border border-gray-200 dark:border-slate-800 shadow-2xl p-6 text-gray-900 dark:text-white">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-[#0099ff]/10 border border-[#0099ff]/20 text-[#0099ff]">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                  {t("title")}
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#0099ff]/20 text-[#0099ff]">
                    {t("badge")}
                  </span>
                </h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {t("subtitle")}
                </p>
              </div>
            </div>

            {/* QR Code Scan Area */}
            <div className="bg-gray-50 dark:bg-[#162032] p-4 rounded-xl border border-gray-200 dark:border-slate-800 text-center mb-4">
              <p className="text-xs font-medium text-gray-700 dark:text-slate-300 mb-3">
                {t("scanTitle")}
              </p>
              <div className="flex justify-center mb-2">
                {qrDataUrl ? (
                  <div className="p-2 bg-white rounded-xl shadow-md border border-gray-200">
                    <img src={qrDataUrl} alt={t("qrAlt")} className="w-36 h-36" />
                  </div>
                ) : (
                  <div className="w-36 h-36 bg-gray-200 dark:bg-slate-700 rounded-xl flex items-center justify-center text-xs text-gray-400">
                    {t("generatingQr")}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">
                {t("scanSub")}
              </p>
            </div>

            {/* Platform Instructions */}
            <div className="space-y-2 mb-5 text-xs text-gray-600 dark:text-slate-300">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#0099ff] shrink-0 mt-0.5" />
                <span>
                  <strong>{t("instructionAndroidPrefix")}</strong>{" "}
                  {t("instructionAndroid")}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#0099ff] shrink-0 mt-0.5" />
                <span>
                  <strong>{t("instructionIosPrefix")}</strong>{" "}
                  {t("instructionIos")}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2">
              {deferredPrompt && (
                <button
                  onClick={handleInstallClick}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-[#0099ff] hover:bg-[#0088e6] text-white text-xs font-semibold shadow-md transition"
                >
                  <Download className="w-4 h-4" />
                  {t("installBtn")}
                </button>
              )}
              <Link
                href="/bot"
                onClick={() => setIsOpen(false)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-800 dark:text-white text-xs font-semibold transition"
              >
                <ExternalLink className="w-4 h-4" />
                {t("openBrowser")}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
