"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { useAuth } from "@/context/AuthContext";
import { getStoredAccounts } from "@/lib/unipile/store";
import {
  CheckCircle2,
  AlertTriangle,
  LifeBuoy,
  MessageSquare,
  ShieldCheck,
  Server,
  Send,
  ArrowRight,
} from "lucide-react";

export default function SupportPage() {
  const t = useTranslations("support");
  const { currentUser } = useAuth();
  const [unipileOk, setUnipileOk] = useState<boolean | null>(null);
  const [connectedCount, setConnectedCount] = useState(0);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("linkedin_connection");
  const [details, setDetails] = useState("");
  const [submittedNotice, setSubmittedNotice] = useState<string | null>(null);

  useEffect(() => {
    const accounts = getStoredAccounts();
    setConnectedCount(accounts.filter((a) => a.status === "OK").length);

    fetch("/api/unipile/status")
      .then((res) => res.json())
      .then((data) => {
        setUnipileOk(Boolean(data?.configured && !data?.isExpired));
      })
      .catch(() => setUnipileOk(false));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !details.trim()) return;
    setSubmittedNotice(
      t("ticketSuccessNotice", { name: currentUser.email || currentUser.name })
    );
    setSubject("");
    setDetails("");
    setTimeout(() => setSubmittedNotice(null), 5000);
  };

  return (
    <div className="w-full space-y-6">
      <PageBreadcrumb pageTitle={t("pageTitle")} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-300 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <Server className="size-5 text-[#0099ff]" />
            <div>
              <p className="text-xs font-medium text-gray-500">{t("statusCloud")}</p>
              <p className="mt-0.5 text-sm font-bold text-gray-900 dark:text-white">
                {unipileOk === null
                  ? t("verifying")
                  : unipileOk
                    ? t("connectedOperational")
                    : t("requiresReview")}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-300 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            {connectedCount > 0 ? (
              <CheckCircle2 className="size-5 text-emerald-500" />
            ) : (
              <AlertTriangle className="size-5 text-amber-500" />
            )}
            <div>
              <p className="text-xs font-medium text-gray-500">{t("activeAccountsTitle")}</p>
              <p className="mt-0.5 text-sm font-bold text-gray-900 dark:text-white">
                {connectedCount === 1
                  ? t("activeAccountsSingular", { count: connectedCount })
                  : t("activeAccountsPlural", { count: connectedCount })}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-300 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-emerald-500" />
            <div>
              <p className="text-xs font-medium text-gray-500">{t("planTitle")}</p>
              <p className="mt-0.5 text-sm font-bold uppercase text-gray-900 dark:text-white">
                {t("slotsFormat", { plan: currentUser.planTier, slots: currentUser.slotsLimit })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-gray-300 bg-white p-6 dark:border-gray-800 dark:bg-gray-900 lg:col-span-7">
          <div className="mb-4 flex items-center gap-2.5 border-b border-gray-200 pb-4 dark:border-gray-800">
            <LifeBuoy className="size-5 text-[#0099ff]" />
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t("sendRequestTitle")}
              </h2>
              <p className="text-xs text-gray-500">
                {t("sendRequestSubtitle")}
              </p>
            </div>
          </div>

          {submittedNotice && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{submittedNotice}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("categoryLabel")}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-xs text-gray-900 focus:border-[#0099ff] focus:outline-hidden dark:border-gray-700 dark:text-white"
              >
                <option value="linkedin_connection">{t("categoryConnection")}</option>
                <option value="campaigns_pacing">{t("categoryPacing")}</option>
                <option value="sdr_ai">{t("categorySdr")}</option>
                <option value="billing_slots">{t("categoryBilling")}</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("subjectLabel")}
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("subjectPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-xs text-gray-900 focus:border-[#0099ff] focus:outline-hidden dark:border-gray-700 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("descLabel")}
              </label>
              <textarea
                rows={4}
                required
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={t("descPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-xs text-gray-900 focus:border-[#0099ff] focus:outline-hidden dark:border-gray-700 dark:text-white"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-[#0099ff] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0088e6]"
            >
              <Send className="size-3.5" />
              <span>{t("submitBtn")}</span>
            </button>
          </form>
        </div>

        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-lg border border-gray-300 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("quickAccessTitle")}
            </h3>
            <div className="mt-4 space-y-2.5 text-xs">
              <Link
                href="/linkedin-accounts"
                className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition hover:border-[#0099ff] dark:border-gray-800"
              >
                <span>{t("linkVerifyAccounts")}</span>
                <ArrowRight className="size-4 text-gray-400" />
              </Link>
              <Link
                href="/settings?tab=api-security"
                className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition hover:border-[#0099ff] dark:border-gray-800"
              >
                <span>{t("linkReviewApi")}</span>
                <ArrowRight className="size-4 text-gray-400" />
              </Link>
              <Link
                href="/plans"
                className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition hover:border-[#0099ff] dark:border-gray-800"
              >
                <span>{t("linkManagePlan")}</span>
                <ArrowRight className="size-4 text-gray-400" />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-gray-300 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <MessageSquare className="size-4 text-[#0099ff]" />
              <span>{t("bestPracticesTitle")}</span>
            </div>
            <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-gray-500 dark:text-gray-400">
              <li>{t("bp1")}</li>
              <li>{t("bp2")}</li>
              <li>{t("bp3")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
