"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocale } from "next-intl";
import { InHubLiveAvatar, type InHubEmotion } from "@/components/copilot/InHubLiveAvatar";
import type {
  ApprovalActionPayload,
  VerifiedPersonCandidate,
} from "@/lib/bot/agent-helpers";
import {
  BOT_UI_LABELS,
  getBotLocale,
  getSpeechLang,
  type BotUiLabels,
} from "@/lib/bot/i18n";
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  BarChart3,
  Layers,
  FileText,
  Users,
  Globe,
  PauseCircle,
  PlayCircle,
  Paperclip,
  X,
  Check,
  Pencil,
  Calendar,
  Trash2,
  ExternalLink,
  UserCheck,
  SendHorizonal,
  MessageSquarePlus,
  UserPlus,
  Radar,
  Inbox,
  Kanban,
  Rocket,
  Plus,
} from "lucide-react";

interface ActionCard {
  type:
    | "summary"
    | "campaigns"
    | "post"
    | "leads"
    | "accounts"
    | "profile_verify"
    | "approval"
    | "signals"
    | "inbox"
    | "pipeline"
    | "campaign_draft";
  data: Record<string, any>;
}

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  imagePreviewUrl?: string;
  attachmentName?: string;
  attachmentSize?: string;
  cards?: ActionCard[];
  quickActions?: string[];
  timestamp: string;
}

interface PendingAttachment {
  base64: string;
  mimeType: string;
  fileName: string;
  sizeLabel: string;
  isImage: boolean;
  previewUrl?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<PendingAttachment> {
  if (file.type.startsWith("image/")) {
    return compressImageToBase64(file);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const [hdr, b64] = dataUrl.split(",");
      const mime = hdr?.split(":")[1]?.split(";")[0] || file.type || "application/pdf";
      resolve({
        base64: b64 || "",
        mimeType: mime,
        fileName: file.name,
        sizeLabel: formatFileSize(file.size),
        isImage: false,
      });
    };
    reader.readAsDataURL(file);
  });
}

function compressImageToBase64(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          const [, b64] = dataUrl.split(",");
          resolve({
            base64: b64 || "",
            mimeType: file.type || "image/jpeg",
            fileName: file.name,
            sizeLabel: formatFileSize(file.size),
            isImage: true,
            previewUrl: dataUrl,
          });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outUrl = canvas.toDataURL("image/jpeg", 0.82);
        const [, b64] = outUrl.split(",");
        resolve({
          base64: b64 || "",
          mimeType: "image/jpeg",
          fileName: file.name,
          sizeLabel: formatFileSize(file.size),
          isImage: true,
          previewUrl: outUrl,
        });
      };
      img.onerror = () => {
        const [hdr, b64] = dataUrl.split(",");
        const mime = hdr?.split(":")[1]?.split(";")[0] || file.type || "image/jpeg";
        resolve({
          base64: b64 || "",
          mimeType: mime,
          fileName: file.name,
          sizeLabel: formatFileSize(file.size),
          isImage: true,
          previewUrl: dataUrl,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function getNetworkBadge(distance: string | undefined, ui: BotUiLabels) {
  switch (distance) {
    case "FIRST_DEGREE":
      return {
        label: ui.degree1,
        className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      };
    case "SECOND_DEGREE":
      return {
        label: ui.degree2,
        className: "bg-[#0099ff]/20 text-[#70c4ff] border-[#0099ff]/30",
      };
    case "THIRD_DEGREE":
    case "OUT_OF_NETWORK":
      return {
        label: ui.degree3,
        className: "bg-slate-500/20 text-slate-300 border-slate-500/30",
      };
    default:
      return {
        label: ui.degreeUnknown,
        className: "bg-slate-500/20 text-slate-300 border-slate-500/30",
      };
  }
}

function ProfileVerifyCard({
  candidates,
  intendedAction,
  userContext,
  disabled,
  ui,
  onConfirm,
  onReject,
}: {
  candidates: VerifiedPersonCandidate[];
  intendedAction: string;
  userContext: string;
  disabled: boolean;
  ui: BotUiLabels;
  onConfirm: (person: VerifiedPersonCandidate) => void;
  onReject: (remaining: VerifiedPersonCandidate[]) => void;
}) {
  const [acted, setActed] = useState<"confirmed" | "rejected" | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const current = candidates[0];
  if (!current) return null;

  const remaining = candidates.slice(1);
  const badge = getNetworkBadge(current.networkDistance, ui);
  const initials = current.name
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || "")
    .join("");

  return (
    <div
      className="p-3.5 rounded-2xl space-y-3"
      style={{
        background: "rgba(0,153,255,0.08)",
        border: "1px solid rgba(0,153,255,0.28)",
      }}
    >
      <div className="flex items-center justify-between text-[11px] font-semibold text-[#70c4ff]">
        <span className="flex items-center gap-1.5">
          <UserCheck className="w-3.5 h-3.5 text-[#0099ff]" />
          {ui.verifyTitle}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] border ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-black/40 border border-white/8">
        {current.pictureUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.pictureUrl}
            alt={current.name}
            onError={() => setImgFailed(true)}
            className="w-14 h-14 rounded-full object-cover border-2 border-[#0099ff]/50 shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-[#0099ff]/25 border-2 border-[#0099ff]/40 flex items-center justify-center text-white font-bold text-base shrink-0">
            {initials || "?"}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-white truncate">{current.name}</p>
            {current.profileUrl && (
              <a
                href={current.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0099ff] hover:text-white shrink-0"
                title="LinkedIn"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          <p className="text-xs text-slate-300 line-clamp-2 leading-snug mt-0.5">
            {current.headline}
          </p>
          {(current.company || current.location) && (
            <p className="text-[11px] text-[#5abaff] truncate mt-1">
              {[current.company, current.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {acted ? (
        <div className="text-xs font-medium text-slate-300 px-1">
          {acted === "confirmed" ? ui.confirmedStatus : ui.rejectedStatus}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setActed("confirmed");
              onConfirm(current);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold text-white transition cursor-pointer disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)" }}
          >
            <Check className="w-3.5 h-3.5" />
            {ui.confirmYes}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setActed("rejected");
              onReject(remaining);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium text-slate-300 bg-white/8 hover:bg-white/15 border border-white/10 transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            {remaining.length > 0 ? ui.confirmSeeOther(remaining.length) : ui.confirmNo}
          </button>
        </div>
      )}

      {!acted && intendedAction && userContext && (
        <p className="text-[10px] text-slate-400 px-0.5">{ui.verifySafetyNote}</p>
      )}
    </div>
  );
}

function ApprovalActionCard({
  initialApproval,
  disabled,
  ui,
  onApprove,
  onSchedule,
  onDiscard,
}: {
  initialApproval: ApprovalActionPayload;
  disabled: boolean;
  ui: BotUiLabels;
  onApprove: (approval: ApprovalActionPayload) => void;
  onSchedule: (approval: ApprovalActionPayload, scheduledAt: string) => void;
  onDiscard: () => void;
}) {
  const [draftText, setDraftText] = useState(initialApproval.preview);
  const [isEditing, setIsEditing] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  });
  const [status, setStatus] = useState<"pending" | "approved" | "scheduled" | "discarded">("pending");

  const typeMeta =
    initialApproval.type === "post"
      ? { label: ui.typePost, icon: <FileText className="w-3.5 h-3.5 text-[#0099ff]" />, cta: ui.ctaPost }
      : initialApproval.type === "connection"
        ? { label: ui.typeConnection, icon: <UserPlus className="w-3.5 h-3.5 text-[#0099ff]" />, cta: ui.ctaConnection }
        : initialApproval.type === "comment"
          ? { label: ui.typeComment, icon: <MessageSquarePlus className="w-3.5 h-3.5 text-[#0099ff]" />, cta: ui.ctaComment }
          : { label: ui.typeMessage, icon: <SendHorizonal className="w-3.5 h-3.5 text-[#0099ff]" />, cta: ui.ctaMessage };

  const currentPayload: ApprovalActionPayload = {
    ...initialApproval,
    preview: draftText,
  };

  return (
    <div
      className="p-3.5 rounded-2xl space-y-2.5"
      style={{
        background: "rgba(0,153,255,0.08)",
        border: "1px solid rgba(0,153,255,0.32)",
      }}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[#70c4ff]">
        <span className="flex items-center gap-1.5">
          {typeMeta.icon}
          {typeMeta.label}
        </span>
        {initialApproval.targetName && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 text-slate-200 truncate max-w-[150px]">
            {ui.forLabel} {initialApproval.targetName}
          </span>
        )}
      </div>

      {initialApproval.targetPostSnippet && (
        <div className="p-2 rounded-lg bg-black/35 border border-white/8 text-[11px] text-slate-400 italic line-clamp-2">
          {ui.originalPostLabel} “{initialApproval.targetPostSnippet}...”
        </div>
      )}

      {isEditing && status === "pending" ? (
        <div className="space-y-2">
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={initialApproval.type === "post" ? 7 : 4}
            className="w-full rounded-xl p-2.5 text-xs text-white bg-black/60 border border-[#0099ff]/40 focus:outline-none focus:ring-1 focus:ring-[#0099ff] leading-relaxed"
          />
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="text-[11px] font-semibold text-[#0099ff] hover:text-white cursor-pointer"
          >
            {ui.saveDraftChanges}
          </button>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-black/45 border border-white/8 text-xs text-slate-100 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
          {draftText}
        </div>
      )}

      {status !== "pending" ? (
        <div className="text-xs font-semibold pt-0.5 text-emerald-300">
          {status === "approved" && ui.statusApproved}
          {status === "scheduled" && ui.statusScheduled}
          {status === "discarded" && ui.statusDiscarded}
        </div>
      ) : (
        <div className="space-y-2 pt-0.5">
          {showScheduler && initialApproval.type === "post" && (
            <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-black/50 border border-[#0099ff]/25">
              <input
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="flex-1 min-w-[160px] bg-transparent text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                disabled={disabled || !scheduleDate}
                onClick={() => {
                  setStatus("scheduled");
                  onSchedule(currentPayload, new Date(scheduleDate).toISOString());
                }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#0099ff] text-white cursor-pointer disabled:opacity-50"
              >
                {ui.confirmDateBtn}
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={disabled || !draftText.trim()}
              onClick={() => {
                setStatus("approved");
                onApprove(currentPayload);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition cursor-pointer disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)" }}
            >
              <Check className="w-3.5 h-3.5" />
              {typeMeta.cta}
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsEditing((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-200 bg-white/8 hover:bg-white/15 border border-white/10 transition cursor-pointer"
            >
              <Pencil className="w-3 h-3" />
              {isEditing ? ui.doneEditBtn : ui.editBtn}
            </button>

            {initialApproval.type === "post" && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setShowScheduler((prev) => !prev)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-[#70c4ff] bg-[#0099ff]/12 hover:bg-[#0099ff]/20 border border-[#0099ff]/25 transition cursor-pointer"
              >
                <Calendar className="w-3 h-3" />
                {ui.scheduleBtn}
              </button>
            )}

            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setStatus("discarded");
                onDiscard();
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              {ui.discardBtn}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignDraftCard({
  initialName,
  initialIcebreaker,
  disabled,
  ui,
  onCreate,
  onDiscard,
}: {
  initialName: string;
  initialIcebreaker: string;
  disabled: boolean;
  ui: BotUiLabels;
  onCreate: (name: string, icebreaker: string) => void;
  onDiscard: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [icebreaker, setIcebreaker] = useState(initialIcebreaker);
  const [status, setStatus] = useState<"pending" | "created" | "discarded">("pending");

  return (
    <div
      className="p-3.5 rounded-2xl space-y-2.5"
      style={{
        background: "rgba(0,153,255,0.08)",
        border: "1px solid rgba(0,153,255,0.32)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#70c4ff]">
        <Rocket className="w-3.5 h-3.5 text-[#0099ff]" />
        <span>{ui.campaignDraftTitle}</span>
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-[10px] text-[#5abaff] mb-1">{ui.campaignNameLabel}</label>
          <input
            type="text"
            value={name}
            disabled={status !== "pending"}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl px-2.5 py-2 text-xs text-white bg-black/50 border border-white/10 focus:outline-none focus:border-[#0099ff] disabled:opacity-70"
          />
        </div>
        <div>
          <label className="block text-[10px] text-[#5abaff] mb-1">{ui.campaignIcebreakerLabel}</label>
          <textarea
            rows={3}
            value={icebreaker}
            disabled={status !== "pending"}
            onChange={(e) => setIcebreaker(e.target.value)}
            className="w-full rounded-xl px-2.5 py-2 text-xs text-slate-100 bg-black/50 border border-white/10 focus:outline-none focus:border-[#0099ff] leading-relaxed disabled:opacity-70"
          />
        </div>
      </div>

      {status !== "pending" ? (
        <div className="text-xs font-semibold text-emerald-300">
          {status === "created" ? ui.campaignCreatedStatus : ui.statusDiscarded}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={disabled || !name.trim()}
            onClick={() => {
              setStatus("created");
              onCreate(name.trim(), icebreaker.trim());
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)" }}
          >
            <Check className="w-3.5 h-3.5" />
            {ui.createCampaignCta}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setStatus("discarded");
              onDiscard();
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            {ui.discardBtn}
          </button>
        </div>
      )}
    </div>
  );
}

export default function InhubBotAppPage() {
  const rawLocale = useLocale();
  const locale = getBotLocale(rawLocale);
  const ui = BOT_UI_LABELS[locale];
  const speechLang = getSpeechLang(locale);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isHoldingMic, setIsHoldingMic] = useState(false);
  const [holdHint, setHoldHint] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [emotion, setEmotion] = useState<InHubEmotion>("idle");
  const [recognitionSupported, setRecognitionSupported] = useState(true);

  const recognitionRef = useRef<any>(null);
  const userStoppedVoiceRef = useRef(true);
  const voiceActiveRef = useRef(false);
  const isHoldingMicRef = useRef(false);
  const voiceBaseTextRef = useRef("");
  const sessionFinalTextRef = useRef("");
  const liveVoiceTranscriptRef = useRef("");
  const pressStartedAtRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSendRef = useRef<
    (
      customText?: string,
      explicitAction?: string,
      explicitPayload?: Record<string, unknown>,
      overrideAttachment?: PendingAttachment | null
    ) => Promise<void> | void
  >(() => {});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const carouselScrollRef = useRef<HTMLDivElement | null>(null);
  const carouselTrackRef = useRef<HTMLDivElement | null>(null);
  const carouselPausedUntilRef = useRef(0);
  const carouselHoverRef = useRef(false);
  const carouselTouchRef = useRef(false);
  const carouselDragRef = useRef({
    active: false,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  const stopVoiceSession = useCallback(() => {
    userStoppedVoiceRef.current = true;
    voiceActiveRef.current = false;
    isHoldingMicRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (releaseSendTimerRef.current) {
      clearTimeout(releaseSendTimerRef.current);
      releaseSendTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {}
    setIsHoldingMic(false);
    setIsListening(false);
    setEmotion("idle");
  }, []);

  const speakText = useCallback(
    (text: string) => {
      if (!voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const clean = text.replace(/[*_#`[\]()]/g, "").trim();
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.lang = speechLang;
        utterance.rate = 1.05;
        utterance.pitch = 1.0;

        utterance.onstart = () => setEmotion("talking");
        utterance.onend = () => setEmotion("idle");
        utterance.onerror = () => setEmotion("idle");

        window.speechSynthesis.speak(utterance);
      } catch {
        setEmotion("idle");
      }
    },
    [voiceEnabled, speechLang]
  );

  const handleSend = useCallback(
    async (
      customText?: string,
      explicitAction?: string,
      explicitPayload?: Record<string, unknown>,
      overrideAttachment?: PendingAttachment | null
    ) => {
      const textToSend = (customText !== undefined ? customText : inputValue).trim();
      const attachmentToSend =
        overrideAttachment !== undefined ? overrideAttachment : pendingAttachment;

      if (!textToSend && !explicitAction && !attachmentToSend) return;

      if (voiceActiveRef.current) {
        stopVoiceSession();
      }

      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (textToSend || attachmentToSend) {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            sender: "user",
            text: textToSend,
            imagePreviewUrl: attachmentToSend?.previewUrl,
            attachmentName: attachmentToSend && !attachmentToSend.isImage ? attachmentToSend.fileName : undefined,
            attachmentSize: attachmentToSend && !attachmentToSend.isImage ? attachmentToSend.sizeLabel : undefined,
            timestamp: time,
          },
        ]);
      }

      if (customText === undefined) setInputValue("");
      if (attachmentToSend) setPendingAttachment(null);
      setFileError(null);
      setIsSending(true);
      setEmotion("thinking");

      try {
        const res = await fetch("/api/bot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: textToSend,
            action: explicitAction,
            payload: explicitPayload,
            fileBase64: attachmentToSend?.base64,
            fileMimeType: attachmentToSend?.mimeType,
            fileName: attachmentToSend?.fileName,
            imageBase64: attachmentToSend?.base64,
            imageMimeType: attachmentToSend?.mimeType,
            history: messagesRef.current.slice(-6).map((m) => {
              const cardSnippets = (m.cards || [])
                .map((c) => {
                  if (c.type === "approval" && c.data?.approval?.preview) {
                    return `[Borrador ${String(c.data.approval.type || "post")}]: ${String(
                      c.data.approval.preview
                    ).slice(0, 600)}`;
                  }
                  if (c.type === "profile_verify" && Array.isArray(c.data?.candidates) && c.data.candidates[0]) {
                    const p = c.data.candidates[0] as VerifiedPersonCandidate;
                    return `[Perfil mostrado]: ${p.name} - ${p.headline}`;
                  }
                  return "";
                })
                .filter(Boolean)
                .join("\n");
              return {
                sender: m.sender,
                text: [m.text, cardSnippets].filter(Boolean).join("\n"),
              };
            }),
            locale,
          }),
        });

        const data = await res.json();
        if (data.ok) {
          setEmotion(data.emotion || "talking");
          const botMsg: Message = {
            id: `bot-${Date.now()}`,
            sender: "bot",
            text: data.reply,
            cards: data.cards || [],
            quickActions: data.quickActions || ui.quickActions,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          };
          setMessages((prev) => [...prev, botMsg]);

          if (data.spokenText && voiceEnabled) {
            speakText(data.spokenText);
          } else {
            setTimeout(() => setEmotion("idle"), 2200);
          }
        } else {
          setEmotion("idle");
          setMessages((prev) => [
            ...prev,
            {
              id: `bot-err-${Date.now()}`,
              sender: "bot",
              text: data.reply || ui.genericError,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
        }
      } catch {
        setEmotion("idle");
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-err-${Date.now()}`,
            sender: "bot",
            text: ui.connectionError,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [inputValue, pendingAttachment, speakText, voiceEnabled, locale, ui.quickActions, ui.genericError, ui.connectionError, stopVoiceSession]
  );

  handleSendRef.current = handleSend;

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = speechLang;

        recognition.onstart = () => {
          setIsListening(true);
          setEmotion("thinking");
        };

        recognition.onresult = (event: any) => {
          let sessionFinal = "";
          let sessionInterim = "";
          let lastFinalChunk = "";

          for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            const piece = String(res?.[0]?.transcript || "").trim();
            if (!piece) continue;
            if (res.isFinal) {
              if (piece !== lastFinalChunk) {
                sessionFinal = sessionFinal ? `${sessionFinal} ${piece}` : piece;
                lastFinalChunk = piece;
              }
            } else {
              sessionInterim = sessionInterim ? `${sessionInterim} ${piece}` : piece;
            }
          }

          sessionFinalTextRef.current = sessionFinal;
          const combined = [voiceBaseTextRef.current, sessionFinal, sessionInterim]
            .filter(Boolean)
            .join(" ");
          liveVoiceTranscriptRef.current = combined;
          setInputValue(combined);
        };

        recognition.onerror = (event: any) => {
          const err = String(event?.error || "");
          if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
            userStoppedVoiceRef.current = true;
            voiceActiveRef.current = false;
            setIsListening(false);
            setEmotion("idle");
          }
        };

        recognition.onend = () => {
          // Consolidar lo ya dictado antes de reiniciar o detener
          if (sessionFinalTextRef.current) {
            voiceBaseTextRef.current = [voiceBaseTextRef.current, sessionFinalTextRef.current]
              .filter(Boolean)
              .join(" ");
            sessionFinalTextRef.current = "";
          }

          if (!userStoppedVoiceRef.current && voiceActiveRef.current) {
            // En Android/iOS el navegador corta tras pausas breves: reanudamos sin perder el texto
            restartTimerRef.current = setTimeout(() => {
              if (!userStoppedVoiceRef.current && voiceActiveRef.current) {
                try {
                  recognition.lang = speechLang;
                  recognition.start();
                } catch {
                  userStoppedVoiceRef.current = true;
                  voiceActiveRef.current = false;
                  setIsListening(false);
                  setEmotion("idle");
                }
              }
            }, 120);
          } else {
            setIsListening(false);
            setEmotion("idle");
          }
        };

        recognitionRef.current = recognition;
      } else {
        setRecognitionSupported(false);
      }
    }

    return () => {
      userStoppedVoiceRef.current = true;
      voiceActiveRef.current = false;
      isHoldingMicRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (releaseSendTimerRef.current) clearTimeout(releaseSendTimerRef.current);
      if (holdHintTimerRef.current) clearTimeout(holdHintTimerRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, [speechLang]);

  useEffect(() => {
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages([
      {
        id: "welcome-msg",
        sender: "bot",
        text: ui.welcomeMessage,
        quickActions: ui.quickActions,
        timestamp: now,
      },
    ]);
  }, [ui.welcomeMessage, ui.quickActions]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const getCarouselSingleSetWidth = useCallback(() => {
    const track = carouselTrackRef.current;
    if (!track || track.children.length < 12) return 0;
    const first = track.children[0] as HTMLElement;
    const secondSetStart = track.children[6] as HTMLElement;
    return secondSetStart.offsetLeft - first.offsetLeft;
  }, []);

  const normalizeCarouselLoop = useCallback(() => {
    const el = carouselScrollRef.current;
    if (!el) return;
    const stepWidth = getCarouselSingleSetWidth();
    if (stepWidth <= 0) return;
    if (el.scrollLeft >= stepWidth * 2) {
      el.scrollLeft -= stepWidth;
    } else if (el.scrollLeft <= 2) {
      el.scrollLeft += stepWidth;
    }
  }, [getCarouselSingleSetWidth]);

  useEffect(() => {
    if (messages.length > 1 || isSending) return;
    const el = carouselScrollRef.current;
    if (!el) return;

    const initWidth = getCarouselSingleSetWidth();
    if (initWidth > 0 && el.scrollLeft < 4) {
      el.scrollLeft = initWidth;
    }

    let rafId = 0;
    let carry = 0;

    const tick = () => {
      const container = carouselScrollRef.current;
      if (container) {
        const stepWidth = getCarouselSingleSetWidth();
        if (stepWidth > 0) {
          if (container.scrollLeft >= stepWidth * 2) {
            container.scrollLeft -= stepWidth;
          } else if (container.scrollLeft <= 2) {
            container.scrollLeft += stepWidth;
          }

          if (
            !carouselTouchRef.current &&
            !carouselDragRef.current.active &&
            !carouselHoverRef.current &&
            Date.now() > carouselPausedUntilRef.current
          ) {
            carry += 0.6;
            const px = Math.trunc(carry);
            if (px >= 1) {
              container.scrollLeft += px;
              carry -= px;
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [messages.length, isSending, getCarouselSingleSetWidth]);

  const showShortHoldHint = useCallback(() => {
    setHoldHint(ui.holdHintShort);
    if (holdHintTimerRef.current) clearTimeout(holdHintTimerRef.current);
    holdHintTimerRef.current = setTimeout(() => {
      setHoldHint(null);
    }, 2600);
  }, [ui.holdHintShort]);

  const handleMicPressStart = useCallback(() => {
    if (!recognitionRef.current || isSending || isHoldingMicRef.current) return;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (releaseSendTimerRef.current) {
      clearTimeout(releaseSendTimerRef.current);
      releaseSendTimerRef.current = null;
    }
    if (holdHintTimerRef.current) {
      clearTimeout(holdHintTimerRef.current);
      holdHintTimerRef.current = null;
    }
    setHoldHint(null);

    pressStartedAtRef.current = Date.now();
    isHoldingMicRef.current = true;
    setIsHoldingMic(true);
    userStoppedVoiceRef.current = false;
    voiceActiveRef.current = true;

    const existingDraft = inputValue.trim();
    voiceBaseTextRef.current = existingDraft;
    sessionFinalTextRef.current = "";
    liveVoiceTranscriptRef.current = existingDraft;

    try {
      recognitionRef.current.lang = speechLang;
      recognitionRef.current.start();
    } catch {
      stopVoiceSession();
    }
  }, [inputValue, isSending, speechLang, stopVoiceSession]);

  const handleMicPressEnd = useCallback(() => {
    if (!isHoldingMicRef.current) return;
    isHoldingMicRef.current = false;
    setIsHoldingMic(false);

    const heldMs = Date.now() - pressStartedAtRef.current;
    userStoppedVoiceRef.current = true;
    voiceActiveRef.current = false;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {}
    setIsListening(false);
    setEmotion("idle");

    if (releaseSendTimerRef.current) clearTimeout(releaseSendTimerRef.current);
    releaseSendTimerRef.current = setTimeout(() => {
      releaseSendTimerRef.current = null;
      const finalSpoken = liveVoiceTranscriptRef.current.trim();
      if (finalSpoken) {
        voiceBaseTextRef.current = "";
        sessionFinalTextRef.current = "";
        liveVoiceTranscriptRef.current = "";
        setInputValue("");
        void handleSendRef.current(finalSpoken);
      } else if (heldMs < 400) {
        showShortHoldHint();
      }
    }, 380);
  }, [showShortHoldHint]);

  useEffect(() => {
    if (!isHoldingMic || typeof window === "undefined") return;
    const onGlobalRelease = () => {
      handleMicPressEnd();
    };
    window.addEventListener("pointerup", onGlobalRelease);
    window.addEventListener("pointercancel", onGlobalRelease);
    return () => {
      window.removeEventListener("pointerup", onGlobalRelease);
      window.removeEventListener("pointercancel", onGlobalRelease);
    };
  }, [isHoldingMic, handleMicPressEnd]);

  const handleAttachmentPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    if (!file.type.startsWith("image/") && file.size > 10 * 1024 * 1024) {
      setFileError(ui.fileTooLargeError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const processed = await readFileAsBase64(file);
      setPendingAttachment(processed);
    } catch {
      // ignore invalid file
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleToggleCampaign = (campaignId: string, campaignName: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "paused" : "active";
    handleSend(
      ui.campaignToggleLabel(newStatus === "active", campaignName),
      "toggle_campaign",
      { campaignId, campaignName, status: newStatus },
      null
    );
  };

  const handleClearChat = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setPendingAttachment(null);
    setFileError(null);
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: "bot",
        text: ui.resetMessage,
        quickActions: ui.quickActions,
        timestamp: now,
      },
    ]);
  };

  const renderPushToTalkDock = (variant: "hero" | "chat") => {
    const isHero = variant === "hero";
    const active = isHoldingMic || isListening;
    const statusText = !recognitionSupported
      ? ui.micUnsupportedTitle
      : active
        ? ui.releaseToSendLabel
        : holdHint || ui.holdToTalkLabel;

    return (
      <div
        className={
          isHero
            ? "flex flex-col items-center justify-center mt-5 mb-1 shrink-0"
            : "px-4 py-2.5 flex flex-col items-center justify-center shrink-0 border-t border-[#0099ff]/12"
        }
        style={
          !isHero
            ? { background: "linear-gradient(180deg, rgba(0,153,255,0.04) 0%, #000000 100%)" }
            : undefined
        }
      >
        {active && inputValue.trim() && (
          <div
            className={`${
              isHero ? "mb-3" : "mb-2"
            } max-w-xs sm:max-w-md px-3.5 py-1.5 rounded-full bg-[#0099ff]/15 border border-[#0099ff]/40 text-xs text-white text-center truncate`}
          >
            “{inputValue.trim()}”
          </div>
        )}
        <div className="relative flex items-center justify-center">
          {active && (
            <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping pointer-events-none" />
          )}
          {recognitionSupported ? (
            <button
              type="button"
              disabled={isSending}
              onPointerDown={(e) => {
                e.preventDefault();
                handleMicPressStart();
              }}
              onPointerUp={handleMicPressEnd}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={active ? ui.releaseToSendLabel : ui.holdToTalkLabel}
              title={active ? ui.releaseToSendLabel : ui.holdToTalkLabel}
              className={`relative z-10 flex items-center justify-center rounded-full transition-all duration-150 select-none touch-none cursor-pointer disabled:opacity-40 ${
                isHero ? "w-[74px] h-[74px] sm:w-20 sm:h-20" : "w-14 h-14 sm:w-16 sm:h-16"
              } ${
                active
                  ? "scale-110 bg-red-500 text-white shadow-[0_0_32px_rgba(239,68,68,0.6)]"
                  : "text-white hover:scale-105 active:scale-95"
              }`}
              style={
                !active
                  ? {
                      background: "linear-gradient(135deg, #00aaff 0%, #0070cc 100%)",
                      boxShadow: isHero
                        ? "0 0 28px rgba(0,153,255,0.48), inset 0 1px 1px rgba(255,255,255,0.3)"
                        : "0 0 22px rgba(0,153,255,0.42), inset 0 1px 1px rgba(255,255,255,0.28)",
                    }
                  : {}
              }
            >
              <Mic className={isHero ? "w-8 h-8" : "w-6 h-6 sm:w-7 sm:h-7"} />
            </button>
          ) : (
            <div
              className={`flex items-center justify-center rounded-full bg-white/5 text-slate-500 border border-white/10 ${
                isHero ? "w-[74px] h-[74px]" : "w-14 h-14"
              }`}
              title={ui.micUnsupportedTitle}
            >
              <MicOff className={isHero ? "w-7 h-7" : "w-6 h-6"} />
            </div>
          )}
        </div>
        <span
          className={`${isHero ? "mt-2.5 text-xs px-3" : "mt-1.5 text-[11px]"} font-medium text-center transition-colors ${
            active ? "text-rose-300 animate-pulse" : holdHint ? "text-[#70c4ff]" : "text-slate-400"
          }`}
        >
          {statusText}
        </span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 flex flex-col w-full overflow-hidden font-sans text-slate-100"
      style={{ background: "#000000" }}
    >
      {/* Top Header */}
      <header
        className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-[#0099ff]/15 backdrop-blur z-20"
        style={{ background: "rgba(0,0,0,0.85)" }}
      >
        <div className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/logo/inhubflow-icon-dark.png"
            alt="InhubFlow"
            className="h-9 w-9 object-contain rounded-xl"
          />
        </div>

        {/* Actions Header */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`flex items-center justify-center w-9 h-9 rounded-xl transition border ${
              voiceEnabled
                ? "bg-[#0099ff] text-white shadow-lg shadow-[#0099ff]/20 border-[#0099ff]/50"
                : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border-white/8"
            }`}
            title={voiceEnabled ? ui.voiceDisableTitle : ui.voiceEnableTitle}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={handleClearChat}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition border border-white/8"
            title={ui.resetChatTitle}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── GEMINI HERO ── */}
      {messages.length <= 1 && !isSending && (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0 overflow-y-auto px-6 py-3">
          <h1 className="text-[28px] sm:text-4xl font-light text-white tracking-tight mb-1 text-center">
            {ui.greetingTitle}
          </h1>
          <p className="text-[17px] sm:text-lg font-light text-white text-center leading-snug mb-5">
            {ui.greetingSubtitle}
          </p>

          <div className="relative mb-6 flex items-center justify-center">
            {/* Halo exterior ambiental azul InhubFlow */}
            <div
              className="absolute inset-0 rounded-full blur-3xl pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(0,153,255,0.65) 0%, rgba(0,112,204,0.32) 45%, transparent 76%)",
                transform: "scale(2.35)",
              }}
            />
            {/* Halo medio vibrante */}
            <div
              className="absolute inset-0 rounded-full blur-2xl pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(0,153,255,0.88) 0%, rgba(0,153,255,0.42) 52%, transparent 78%)",
                transform: "scale(1.65)",
              }}
            />
            {/* Núcleo luminoso cercano al robot */}
            <div
              className="absolute inset-0 rounded-full blur-md pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(90,186,255,0.8) 0%, rgba(0,153,255,0.45) 55%, transparent 80%)",
                transform: "scale(1.18)",
              }}
            />
            <div className="relative z-10">
              <InHubLiveAvatar emotion={emotion} size="2xl" hideStatusDot />
            </div>
          </div>

          {/* 1-Line Infinite Carousel of Quick Actions (Auto-scrolling + Swipe/Drag in both directions) */}
          <div
            ref={carouselScrollRef}
            onScroll={normalizeCarouselLoop}
            onTouchStart={() => {
              carouselTouchRef.current = true;
            }}
            onTouchEnd={() => {
              carouselTouchRef.current = false;
              carouselPausedUntilRef.current = Date.now() + 1400;
            }}
            onTouchCancel={() => {
              carouselTouchRef.current = false;
              carouselPausedUntilRef.current = Date.now() + 1400;
            }}
            onMouseEnter={() => {
              carouselHoverRef.current = true;
            }}
            onMouseLeave={() => {
              carouselHoverRef.current = false;
              carouselDragRef.current.active = false;
            }}
            onPointerDown={(e) => {
              if (e.pointerType !== "mouse" || !carouselScrollRef.current) return;
              carouselDragRef.current = {
                active: true,
                startX: e.clientX,
                startScrollLeft: carouselScrollRef.current.scrollLeft,
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              if (!carouselDragRef.current.active || !carouselScrollRef.current) return;
              const dx = e.clientX - carouselDragRef.current.startX;
              if (Math.abs(dx) > 5) carouselDragRef.current.moved = true;
              carouselScrollRef.current.scrollLeft = carouselDragRef.current.startScrollLeft - dx;
              normalizeCarouselLoop();
            }}
            onPointerUp={() => {
              if (!carouselDragRef.current.active) return;
              carouselDragRef.current.active = false;
              if (carouselDragRef.current.moved) {
                carouselPausedUntilRef.current = Date.now() + 1200;
                setTimeout(() => {
                  carouselDragRef.current.moved = false;
                }, 60);
              }
            }}
            className="w-full max-w-xl overflow-x-auto touch-pan-x select-none py-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            style={{
              WebkitMaskImage:
                "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
              maskImage:
                "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
            }}
          >
            <div ref={carouselTrackRef} className="flex w-max gap-2.5 px-2">
              {(() => {
                const heroItems = [
                  { icon: <FileText className="w-4 h-4" />, label: ui.heroChips[0] },
                  { icon: <Radar className="w-4 h-4" />, label: ui.heroChips[1] },
                  { icon: <Rocket className="w-4 h-4" />, label: ui.heroChips[2] },
                  { icon: <Inbox className="w-4 h-4" />, label: ui.heroChips[3] },
                  { icon: <Kanban className="w-4 h-4" />, label: ui.heroChips[4] },
                  { icon: <BarChart3 className="w-4 h-4" />, label: ui.heroChips[5] },
                ];
                return [...heroItems, ...heroItems, ...heroItems].map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (carouselDragRef.current.moved) {
                        carouselDragRef.current.moved = false;
                        return;
                      }
                      handleSend(chip.label, undefined, undefined, null);
                    }}
                    disabled={isSending || isListening}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 transition cursor-pointer disabled:opacity-50 hover:border-[#0099ff]/60 hover:text-white"
                    style={{
                      background: "rgba(0,153,255,0.09)",
                      border: "1px solid rgba(0,153,255,0.28)",
                      color: "#bde2fc",
                    }}
                  >
                    <span className="text-[#0099ff] shrink-0">{chip.icon}</span>
                    <span>{chip.label}</span>
                  </button>
                ));
              })()}
            </div>
          </div>

          {/* Central Push-to-Talk Mic Button (Hero - Below Carousel) */}
          {renderPushToTalkDock("hero")}
        </div>
      )}

      {/* ── CONVERSATION STREAM ── */}
      {messages.length > 1 && (
        <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m) => {
            const isUser = m.sender === "user";
            return (
              <div
                key={m.id}
                className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-full`}
              >
                <div
                  className={`max-w-[92%] sm:max-w-[78%] rounded-2xl px-4 py-3 shadow-md ${
                    isUser
                      ? "bg-[#0099ff] text-white rounded-br-xs"
                      : "text-slate-100 rounded-bl-xs"
                  }`}
                  style={
                    !isUser
                      ? { background: "rgba(0,153,255,0.08)", border: "1px solid rgba(0,153,255,0.15)" }
                      : {}
                  }
                >
                  {!isUser && (
                    <div className="flex items-center gap-2 mb-1.5 text-xs text-[#0099ff] font-medium">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>InhubBot</span>
                    </div>
                  )}

                  {m.imagePreviewUrl && (
                    <div className="mb-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.imagePreviewUrl}
                        alt="Photo"
                        className="rounded-xl max-h-52 object-cover border border-white/20"
                      />
                    </div>
                  )}

                  {m.attachmentName && (
                    <div className="mb-2 flex items-center gap-2 px-2.5 py-2 rounded-xl bg-black/25 border border-white/20 text-xs text-white">
                      <FileText className="w-4 h-4 shrink-0 text-white" />
                      <span className="truncate max-w-[200px] font-medium">{m.attachmentName}</span>
                      {m.attachmentSize && (
                        <span className="text-[10px] text-blue-100 shrink-0">{m.attachmentSize}</span>
                      )}
                    </div>
                  )}

                  {m.text && (
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">
                      {m.text.split("\n").map((line, idx) => {
                        const formatted = line.split(/(\*\*[^*]+\*\*)/g).map((part, pidx) => {
                          if (part.startsWith("**") && part.endsWith("**")) {
                            return (
                              <strong key={pidx} className="font-semibold text-white">
                                {part.slice(2, -2)}
                              </strong>
                            );
                          }
                          return <span key={pidx}>{part}</span>;
                        });
                        return (
                          <React.Fragment key={idx}>
                            {idx > 0 && <br />}
                            {formatted}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}

                  {m.cards && m.cards.length > 0 && (
                    <div className="mt-3 space-y-3 pt-2 border-t border-[#0099ff]/15">
                      {m.cards.map((card, cidx) => {
                        if (card.type === "profile_verify") {
                          const candidates = (card.data.candidates || []) as VerifiedPersonCandidate[];
                          const intendedAction = String(card.data.intendedAction || "auto");
                          const userContext = String(card.data.userContext || "");
                          return (
                            <ProfileVerifyCard
                              key={cidx}
                              candidates={candidates}
                              intendedAction={intendedAction}
                              userContext={userContext}
                              disabled={isSending}
                              ui={ui}
                              onConfirm={(person) =>
                                handleSend(
                                  ui.confirmPersonLabel(person.name),
                                  "confirm_profile",
                                  { person, intendedAction, userContext },
                                  null
                                )
                              }
                              onReject={(remaining) =>
                                handleSend(
                                  ui.rejectPersonLabel,
                                  "reject_profile",
                                  { remaining, intendedAction, userContext },
                                  null
                                )
                              }
                            />
                          );
                        }

                        if (card.type === "approval" && card.data.approval) {
                          const approval = card.data.approval as ApprovalActionPayload;
                          return (
                            <ApprovalActionCard
                              key={cidx}
                              initialApproval={approval}
                              disabled={isSending}
                              ui={ui}
                              onApprove={(editedApproval) =>
                                handleSend(
                                  ui.approveCmdLabel,
                                  "approve_action",
                                  { approval: editedApproval },
                                  null
                                )
                              }
                              onSchedule={(editedApproval, scheduledAt) =>
                                handleSend(
                                  ui.scheduleCmdLabel,
                                  "schedule_action",
                                  { approval: editedApproval, scheduledAt },
                                  null
                                )
                              }
                              onDiscard={() =>
                                handleSend(ui.discardCmdLabel, "discard_action", {}, null)
                              }
                            />
                          );
                        }

                        if (card.type === "summary") {
                          const s = card.data;
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2.5"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.15)" }}
                            >
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                                <span className="flex items-center gap-1.5">
                                  <BarChart3 className="w-3.5 h-3.5 text-[#0099ff]" />
                                  {ui.keyMetrics}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                                  {ui.realtimeBadge}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">{ui.crmLeads}</span>
                                  <span className="text-lg font-bold text-white">{s.leads?.total || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">{ui.highIntent}</span>
                                  <span className="text-lg font-bold text-emerald-400">{s.leads?.qualified || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">{ui.activeCampaigns}</span>
                                  <span className="text-lg font-bold text-[#0099ff]">{s.campaigns?.active || 0} / {s.campaigns?.total || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">{ui.scheduledPosts}</span>
                                  <span className="text-lg font-bold text-amber-400">{s.posts?.scheduled || 0}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (card.type === "campaigns") {
                          const { campaigns } = card.data;
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.15)" }}
                            >
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                                <span className="flex items-center gap-1.5">
                                  <Layers className="w-3.5 h-3.5 text-[#0099ff]" />
                                  {ui.linearSequences}
                                </span>
                              </div>
                              <div className="space-y-1.5">
                                {campaigns.map((camp: any) => {
                                  const isActive = camp.status === "active";
                                  return (
                                    <div
                                      key={camp.id}
                                      className="flex items-center justify-between p-2 rounded-lg text-xs bg-white/5"
                                    >
                                      <div className="min-w-0 pr-2">
                                        <span className="font-medium text-white block truncate">{camp.name}</span>
                                        <span className="text-[10px] text-[#5abaff]">{ui.codeLabel} {camp.code}</span>
                                      </div>
                                      <button
                                        onClick={() => handleToggleCampaign(camp.id, camp.name, camp.status)}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                                          isActive
                                            ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                                            : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                        }`}
                                      >
                                        {isActive ? (<><PauseCircle className="w-3 h-3" /> {ui.pauseBtn}</>) : (<><PlayCircle className="w-3 h-3" /> {ui.activateBtn}</>)}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        }

                        if (card.type === "post") {
                          const post = card.data;
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2 text-xs"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.15)" }}
                            >
                              <div className="flex items-center justify-between font-semibold text-slate-300">
                                <span className="flex items-center gap-1.5">
                                  <FileText className="w-3.5 h-3.5 text-[#0099ff]" />
                                  {post.title}
                                </span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                  post.status === "scheduled" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"
                                }`}>
                                  {post.status === "scheduled" ? ui.scheduledBadge : ui.draftBadge}
                                </span>
                              </div>
                              <p className="text-slate-300 line-clamp-3 p-2 rounded-lg font-mono text-[11px] bg-white/5">
                                {post.content}
                              </p>
                            </div>
                          );
                        }

                        if (card.type === "leads") {
                          const { leads } = card.data;
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2 text-xs"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.15)" }}
                            >
                              <div className="flex items-center justify-between font-semibold text-slate-300">
                                <span className="flex items-center gap-1.5">
                                  <Users className="w-3.5 h-3.5 text-[#0099ff]" />
                                  {ui.qualifiedLeads}
                                </span>
                              </div>
                              <div className="space-y-1.5">
                                {leads.map((l: any) => (
                                  <div key={l.id} className="flex items-center justify-between p-2 rounded-lg text-xs bg-white/5">
                                    <div className="min-w-0 pr-2">
                                      <span className="font-medium text-white block truncate">{l.name}</span>
                                      <span className="text-[10px] text-[#5abaff] block truncate">{l.headline}</span>
                                    </div>
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                                      {l.score} pts
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        if (card.type === "accounts") {
                          const acc = card.data;
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2 text-xs"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.15)" }}
                            >
                              <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-[#0099ff]" />
                                <span className="font-semibold text-white">{ui.linkedinStatus}</span>
                              </div>
                              <div className="p-2 rounded-lg flex items-center justify-between bg-white/5">
                                <span className="text-[#5abaff]">{ui.activeAccountsLabel}</span>
                                <span className="font-bold text-white">{acc.active} / {acc.total}</span>
                              </div>
                            </div>
                          );
                        }

                        if (card.type === "signals") {
                          const signals = (card.data.signals || []) as Array<{
                            id: string;
                            level: string;
                            title: string;
                            status: string;
                            leadsCount: number;
                          }>;
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2.5 text-xs"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.2)" }}
                            >
                              <div className="flex items-center justify-between font-semibold text-slate-200">
                                <span className="flex items-center gap-1.5">
                                  <Radar className="w-3.5 h-3.5 text-[#0099ff]" />
                                  {ui.signalsTitle}
                                </span>
                                <button
                                  type="button"
                                  disabled={isSending}
                                  onClick={() =>
                                    handleSend(ui.createSignalCmdLabel, "create_signal", {}, null)
                                  }
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0099ff]/20 text-[#70c4ff] hover:text-white text-[10px] font-semibold cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                  {ui.createSignalBtn}
                                </button>
                              </div>

                              {signals.length === 0 ? (
                                <p className="text-slate-300 text-xs">{ui.noSignalsText}</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {signals.map((sig) => {
                                    const isActive = sig.status === "active";
                                    const nextStatus = isActive ? "paused" : "active";
                                    return (
                                      <div
                                        key={sig.id}
                                        className="flex items-center justify-between p-2 rounded-lg bg-white/5"
                                      >
                                        <div className="min-w-0 pr-2">
                                          <span className="font-medium text-white block truncate">{sig.title}</span>
                                          <span className="text-[10px] text-[#5abaff]">
                                            {sig.level} · {sig.leadsCount} leads
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={isSending}
                                          onClick={() =>
                                            handleSend(
                                              ui.signalToggleLabel(!isActive, sig.title),
                                              "toggle_signal",
                                              { signalId: sig.id, signalTitle: sig.title, status: nextStatus },
                                              null
                                            )
                                          }
                                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                                            isActive
                                              ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                                              : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                          }`}
                                        >
                                          {isActive ? (
                                            <>
                                              <PauseCircle className="w-3 h-3" /> {ui.pauseBtn}
                                            </>
                                          ) : (
                                            <>
                                              <PlayCircle className="w-3 h-3" /> {ui.activateBtn}
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (card.type === "campaign_draft") {
                          return (
                            <CampaignDraftCard
                              key={cidx}
                              initialName={String(card.data.name || "")}
                              initialIcebreaker={String(card.data.icebreaker || "")}
                              disabled={isSending}
                              ui={ui}
                              onCreate={(name, icebreaker) =>
                                handleSend(
                                  `${ui.createCampaignCmdLabel}: ${name}`,
                                  "create_campaign_confirm",
                                  { name, icebreaker },
                                  null
                                )
                              }
                              onDiscard={() =>
                                handleSend(ui.discardCmdLabel, "discard_action", {}, null)
                              }
                            />
                          );
                        }

                        if (card.type === "inbox") {
                          const inbox = card.data as {
                            total?: number;
                            unreadCount?: number;
                            pendingSdrDrafts?: number;
                            conversations?: Array<{
                              id: string;
                              leadName: string;
                              stage: string;
                              unread: number;
                              lastMessage?: string;
                            }>;
                          };
                          const convs = inbox.conversations || [];
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2.5 text-xs"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.2)" }}
                            >
                              <div className="flex items-center justify-between font-semibold text-slate-200">
                                <span className="flex items-center gap-1.5">
                                  <Inbox className="w-3.5 h-3.5 text-[#0099ff]" />
                                  {ui.inboxTitle}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0099ff]/20 text-[#70c4ff]">
                                  {inbox.unreadCount || 0} {ui.unreadLabel}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[10px] text-[#5abaff] block">{ui.unreadLabel}</span>
                                  <span className="text-base font-bold text-white">{inbox.unreadCount || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[10px] text-[#5abaff] block">{ui.pendingSdrLabel}</span>
                                  <span className="text-base font-bold text-amber-300">{inbox.pendingSdrDrafts || 0}</span>
                                </div>
                              </div>
                              {convs.length === 0 ? (
                                <p className="text-slate-300 text-xs">{ui.noInboxText}</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {convs.map((c) => (
                                    <div key={c.id} className="p-2 rounded-lg bg-white/5 flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <span className="font-medium text-white block truncate">{c.leadName}</span>
                                        {c.lastMessage && (
                                          <span className="text-[10px] text-slate-300 block truncate">{c.lastMessage}</span>
                                        )}
                                      </div>
                                      {c.unread > 0 && (
                                        <span className="px-1.5 py-0.5 rounded-full bg-[#0099ff] text-white text-[10px] font-bold shrink-0">
                                          {c.unread}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (card.type === "pipeline") {
                          const pipe = card.data as {
                            total?: number;
                            stages?: Array<{ stage: string; count: number }>;
                            topLeads?: Array<{
                              id: string;
                              name: string;
                              headline: string;
                              stage: string;
                              score: number;
                            }>;
                          };
                          const stages = pipe.stages || [];
                          const topLeads = pipe.topLeads || [];
                          return (
                            <div
                              key={cidx}
                              className="p-3 rounded-xl space-y-2.5 text-xs"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.2)" }}
                            >
                              <div className="flex items-center justify-between font-semibold text-slate-200">
                                <span className="flex items-center gap-1.5">
                                  <Kanban className="w-3.5 h-3.5 text-[#0099ff]" />
                                  {ui.pipelineTitle}
                                </span>
                                <span className="text-[10px] text-[#70c4ff]">
                                  {ui.totalLeadsLabel}: {pipe.total || 0}
                                </span>
                              </div>
                              {stages.length === 0 ? (
                                <p className="text-slate-300 text-xs">{ui.noPipelineText}</p>
                              ) : (
                                <>
                                  <div className="flex flex-wrap gap-1.5">
                                    {stages.map((st) => (
                                      <span
                                        key={st.stage}
                                        className="px-2 py-1 rounded-lg bg-white/6 border border-white/10 text-[10px] text-slate-200"
                                      >
                                        {st.stage}: <strong className="text-white">{st.count}</strong>
                                      </span>
                                    ))}
                                  </div>
                                  {topLeads.length > 0 && (
                                    <div className="space-y-1 pt-1">
                                      <span className="text-[10px] text-[#5abaff] font-semibold block">
                                        {ui.topLeadsLabel}
                                      </span>
                                      {topLeads.slice(0, 3).map((l) => (
                                        <div key={l.id} className="flex items-center justify-between p-1.5 rounded-lg bg-white/5">
                                          <span className="truncate text-white font-medium pr-2">{l.name}</span>
                                          <span className="text-[10px] font-bold text-emerald-400 shrink-0">{l.score} pts</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        }

                        return null;
                      })}
                    </div>
                  )}

                  <span className={`block text-[10px] mt-2 ${isUser ? "text-blue-100" : "text-[#5abaff]/60"}`}>
                    {m.timestamp}
                  </span>
                </div>
              </div>
            );
          })}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-[#5abaff] pl-2">
              <span className="flex gap-0.5">
                <span className="w-1.5 h-1.5 bg-[#0099ff]/60 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-[#0099ff]/60 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-[#0099ff]/60 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
              {ui.processingText}
            </div>
          )}

          <div ref={chatEndRef} />
        </main>
      )}

      {/* Quick Action Chips */}
      {messages.length > 1 && (
        <div className="px-3 py-2 overflow-x-auto flex gap-2 no-scrollbar shrink-0 border-t border-[#0099ff]/12">
          {ui.quickActions.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(chip, undefined, undefined, null)}
              disabled={isSending || isListening}
              className="shrink-0 text-xs px-3 py-1.5 rounded-full transition disabled:opacity-50 cursor-pointer"
              style={{
                background: "rgba(0,153,255,0.08)",
                border: "1px solid rgba(0,153,255,0.2)",
                color: "#a8d8f8",
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Central Push-to-Talk Mic Dock (Active Conversation) */}
      {messages.length > 1 && renderPushToTalkDock("chat")}

      {/* Bottom Command Input Bar */}
      <footer
        className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0 border-t border-[#0099ff]/12"
        style={{ background: "#000000" }}
      >
        {fileError && (
          <div className="max-w-4xl mx-auto mb-2 px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between">
            <span>{fileError}</span>
            <button type="button" onClick={() => setFileError(null)} className="ml-2 text-rose-200 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {pendingAttachment && (
          <div className="max-w-4xl mx-auto mb-2.5 flex items-center gap-2.5 px-1">
            {pendingAttachment.isImage && pendingAttachment.previewUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pendingAttachment.previewUrl}
                  alt="Preview"
                  className="w-14 h-14 rounded-xl object-cover border border-[#0099ff]/40"
                />
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  aria-label="Remove file"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black text-white border border-white/25 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0099ff]/12 border border-[#0099ff]/35 text-xs text-white max-w-[260px]">
                <FileText className="w-4 h-4 text-[#0099ff] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{pendingAttachment.fileName}</p>
                  <p className="text-[10px] text-[#70c4ff]">{pendingAttachment.sizeLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  aria-label="Remove file"
                  className="p-0.5 rounded-full text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <span className="text-xs text-[#70c4ff]">
              {pendingAttachment.isImage
                ? ui.imageReadyHint
                : ui.attachmentReadyHint(pendingAttachment.fileName)}
            </span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 max-w-4xl mx-auto"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white/6 text-[#70c4ff] hover:text-white hover:bg-[#0099ff]/20 border border-[#0099ff]/25 transition shrink-0 cursor-pointer disabled:opacity-40"
            title={ui.cameraTitle}
            aria-label={ui.cameraTitle}
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.csv,application/pdf,text/plain"
            className="hidden"
            onChange={handleAttachmentPicked}
          />

          <div className="relative flex-1">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                isListening
                  ? ui.inputListeningPlaceholder
                  : pendingAttachment
                    ? ui.inputImagePlaceholder
                    : ui.inputDefaultPlaceholder
              }
              disabled={isSending}
              className="w-full h-11 px-4 rounded-2xl text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#0099ff] transition"
              style={{
                background: "rgba(0,153,255,0.08)",
                border: "1px solid rgba(0,153,255,0.25)",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={(!inputValue.trim() && !pendingAttachment) || isSending}
            className="flex items-center justify-center w-11 h-11 rounded-2xl text-white disabled:opacity-30 transition shadow-lg shrink-0 cursor-pointer"
            style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)", boxShadow: "0 4px 15px rgba(0,153,255,0.25)" }}
            title={ui.sendTitle}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </footer>
    </div>
  );
}
