"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { ConnectedLinkedInAccount } from "@/lib/unipile/types";
import { useTranslations } from "next-intl";

interface ConfigureAccountLimitsModalProps {
  isOpen: boolean;
  account: ConnectedLinkedInAccount | null;
  onClose: () => void;
  onSave: (updated: ConnectedLinkedInAccount) => void;
}

const TIMEZONES = [
  { value: "Pacific/Midway", label: "UTC−11 — Midway Island" },
  { value: "Pacific/Honolulu", label: "UTC−10 — Hawaii" },
  { value: "America/Anchorage", label: "UTC−9  — Alaska" },
  { value: "America/Los_Angeles", label: "UTC−8  — Pacific Time (US)" },
  { value: "America/Denver", label: "UTC−7  — Mountain Time (US)" },
  { value: "America/Chicago", label: "UTC−6  — Central Time (US)" },
  { value: "America/New_York", label: "UTC−5  — Eastern Time (US)" },
  { value: "America/Caracas", label: "UTC−4  — Caracas, La Paz" },
  { value: "America/Sao_Paulo", label: "UTC−3  — São Paulo, Buenos Aires" },
  { value: "America/Noronha", label: "UTC−2  — Mid-Atlantic" },
  { value: "Atlantic/Azores", label: "UTC−1  — Azores" },
  { value: "UTC", label: "UTC+0  — London (no DST)" },
  { value: "Europe/London", label: "UTC+0/+1 — London (BST)" },
  { value: "Europe/Madrid", label: "UTC+1/+2 — Madrid, París, Berlín" },
  { value: "Europe/Helsinki", label: "UTC+2/+3 — Helsinki, Kyiv, Tallinn" },
  { value: "Europe/Moscow", label: "UTC+3  — Moscow, Istanbul" },
  { value: "Asia/Dubai", label: "UTC+4  — Dubai, Abu Dhabi" },
  { value: "Asia/Karachi", label: "UTC+5  — Karachi, Islamabad" },
  { value: "Asia/Kolkata", label: "UTC+5:30 — India" },
  { value: "Asia/Dhaka", label: "UTC+6  — Dhaka, Almaty" },
  { value: "Asia/Bangkok", label: "UTC+7  — Bangkok, Jakarta, Hanoi" },
  { value: "Asia/Shanghai", label: "UTC+8  — Beijing, Singapore, HK" },
  { value: "Asia/Tokyo", label: "UTC+9  — Tokyo, Seoul" },
  { value: "Australia/Sydney", label: "UTC+10/+11 — Sydney" },
  { value: "Pacific/Auckland", label: "UTC+12/+13 — Auckland" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function fmtHour(h: number) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export default function ConfigureAccountLimitsModal({
  isOpen,
  account,
  onClose,
  onSave,
}: ConfigureAccountLimitsModalProps) {
  const t = useTranslations("accounts.modalLimits");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [targetLanguage, setTargetLanguage] = useState<"es" | "pt" | "en">("es");
  const [connectionLimit, setConnectionLimit] = useState(20);
  const [messageLimit, setMessageLimit] = useState(20);
  const [visitLimit, setVisitLimit] = useState(20);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(18);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [workingDays, setWorkingDays] = useState("1,2,3,4,5");
  const [error, setError] = useState<string | null>(null);

  const WEEKDAYS = [
    { iso: 1, short: t("weekdays.mon") },
    { iso: 2, short: t("weekdays.tue") },
    { iso: 3, short: t("weekdays.wed") },
    { iso: 4, short: t("weekdays.thu") },
    { iso: 5, short: t("weekdays.fri") },
    { iso: 6, short: t("weekdays.sat") },
    { iso: 7, short: t("weekdays.sun") },
  ];

  useEffect(() => {
    if (account && isOpen) {
      setName(account.name || "");
      setEmail(account.email || "");
      setTargetLanguage(account.targetLanguage || "es");
      setConnectionLimit(Math.min(20, account.daily_connection_limit ?? 20));
      setMessageLimit(Math.min(20, account.daily_message_limit ?? 20));
      setVisitLimit(Math.min(20, account.daily_visit_limit ?? 20));
      setStartHour(account.active_hours_start ?? 9);
      setEndHour(account.active_hours_end ?? 18);
      setTimezone(account.timezone || "America/Sao_Paulo");
      setWorkingDays(account.working_days || "1,2,3,4,5");
      setError(null);
    }
  }, [account, isOpen]);

  if (!isOpen || !account) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !email.trim()) {
      setError(t("errorRequired"));
      return;
    }

    if (startHour >= endHour) {
      setError(t("errorTime"));
      return;
    }

    const updated: ConnectedLinkedInAccount = {
      ...account,
      name: name.trim(),
      email: email.trim(),
      targetLanguage,
      daily_connection_limit: Math.min(20, Math.max(1, Number(connectionLimit))),
      daily_message_limit: Math.min(20, Math.max(1, Number(messageLimit))),
      daily_visit_limit: Math.min(20, Math.max(0, Number(visitLimit))),
      active_hours_start: Number(startHour),
      active_hours_end: Number(endHour),
      timezone,
      working_days: workingDays,
    };

    onSave(updated);
    onClose();
  };

  const langs = [
    { id: "es", label: t("langEs"), desc: t("langEsDesc") },
    { id: "pt", label: t("langPt"), desc: t("langPtDesc") },
    { id: "en", label: t("langEn"), desc: t("langEnDesc") },
  ];

  return (
    <div className="fixed inset-0 z-99999 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-lg border border-gray-300 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 overflow-hidden my-8">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#0A66C2]/10 text-[#0A66C2] flex items-center justify-center font-bold text-lg select-none">
              in
            </div>
            <div>
              <h3 className="font-bold text-base text-gray-900 dark:text-white leading-snug">
                {t("title")}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("step")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            title={t("cancel")}
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit}>
          <div className="max-h-[520px] overflow-y-auto custom-scrollbar px-6 py-4 flex flex-col gap-3">
            {/* Nombre para mostrar */}
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                {t("displayName")}
              </label>
              <input
                type="text"
                className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                placeholder={t("displayNamePlaceholder")}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                required
              />
            </div>

            {/* Correo de LinkedIn */}
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                {t("email")}
              </label>
              <input
                type="email"
                className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                required
              />
            </div>

            {/* Idioma de Publicación */}
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1.5 block">
                {t("targetLanguage")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {langs.map((lang) => (
                  <button
                    key={lang.id}
                    type="button"
                    onClick={() => setTargetLanguage(lang.id as any)}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition cursor-pointer ${
                      targetLanguage === lang.id
                        ? "border-[#0099ff] bg-[#0099ff]/10 text-[#0099ff] ring-2 ring-[#0099ff]/20 font-bold"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 font-medium"
                    }`}
                  >
                    <span className="text-xs font-semibold">{lang.id.toUpperCase()}</span>
                    <span className="text-xs">{lang.label}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{lang.desc}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {t("targetLanguageDesc")}
              </p>
            </div>

            {/* Límites Diarios */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                  {t("connectionsDay")}
                </label>
                <input
                  type="number"
                  className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  value={connectionLimit}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setConnectionLimit(Math.min(20, Math.max(1, val)));
                  }}
                  min={1}
                  max={20}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                  {t("messagesDay")}
                </label>
                <input
                  type="number"
                  className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  value={messageLimit}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setMessageLimit(Math.min(20, Math.max(1, val)));
                  }}
                  min={1}
                  max={20}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                  {t("inmailDay")}
                </label>
                <input
                  type="number"
                  className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  value={visitLimit}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setVisitLimit(Math.min(20, Math.max(0, val)));
                  }}
                  min={0}
                  max={20}
                />
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1 leading-snug">
              {t("securityNotice")}
            </p>

            {/* Horario de Prospección */}
            <div className="border-t border-gray-300 dark:border-gray-800 pt-3 flex flex-col gap-3">
              <p className="text-xs leading-5 font-normal tracking-normal text-gray-400 uppercase">
                {t("scheduleTitle")}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                    {t("startHour")}
                  </label>
                  <select
                    className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 cursor-pointer"
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {fmtHour(h)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                    {t("endHour")}
                  </label>
                  <select
                    className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 cursor-pointer"
                    value={endHour}
                    onChange={(e) => setEndHour(Number(e.target.value))}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {fmtHour(h)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {startHour >= endHour ? (
                <p className="text-xs text-red-500 font-medium">
                  {t("errorTime")}
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {fmtHour(startHour)} – {fmtHour(endHour)} ({endHour - startHour}h)
                </p>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                  {t("timezone")}
                </label>
                <select
                  className="h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 cursor-pointer"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 pb-1 block">
                  {t("workingDays")}
                </label>
                <div className="flex gap-1.5">
                  {WEEKDAYS.map((day) => {
                    const active = workingDays.split(",").includes(String(day.iso));
                    return (
                      <button
                        key={day.iso}
                        type="button"
                        onClick={() => {
                          const current = workingDays.split(",").filter(Boolean);
                          const next = active
                            ? current.filter((d) => d !== String(day.iso))
                            : [...current, String(day.iso)];
                          if (next.length > 0) {
                            setWorkingDays(next.sort().join(","));
                          }
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          active
                            ? "bg-brand-500/15 border-brand-500 text-brand-600 dark:text-brand-400 font-semibold"
                            : "border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-400"
                        }`}
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-500 font-medium">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-300 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              onClick={onClose}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold bg-[#0066ff] hover:bg-[#0052cc] text-white transition-all shadow-md shadow-blue-500/20 cursor-pointer"
            >
              {t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
