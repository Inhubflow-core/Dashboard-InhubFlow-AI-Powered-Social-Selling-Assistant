"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { InHubLiveAvatar, type InHubEmotion } from "@/components/copilot/InHubLiveAvatar";
import type {
  ApprovalActionPayload,
  VerifiedPersonCandidate,
} from "@/lib/bot/agent-helpers";
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
  Camera,
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
} from "lucide-react";

interface ActionCard {
  type: "summary" | "campaigns" | "post" | "leads" | "accounts" | "profile_verify" | "approval";
  data: Record<string, any>;
}

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  imagePreviewUrl?: string;
  cards?: ActionCard[];
  quickActions?: string[];
  timestamp: string;
}

interface PendingImage {
  base64: string;
  mimeType: string;
  previewUrl: string;
}

const DEFAULT_QUICK_ACTIONS = [
  "Dame el resumen de hoy",
  "¿Cómo van las campañas?",
  "Crear post viral sobre ventas B2B",
  "Últimos prospectos del radar",
  "Estado de mi cuenta de LinkedIn",
];

function compressImageToBase64(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
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
          resolve({ base64: b64 || "", mimeType: file.type || "image/jpeg", previewUrl: dataUrl });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outUrl = canvas.toDataURL("image/jpeg", 0.82);
        const [, b64] = outUrl.split(",");
        resolve({ base64: b64 || "", mimeType: "image/jpeg", previewUrl: outUrl });
      };
      img.onerror = () => {
        const [hdr, b64] = dataUrl.split(",");
        const mime = hdr?.split(":")[1]?.split(";")[0] || file.type || "image/jpeg";
        resolve({ base64: b64 || "", mimeType: mime, previewUrl: dataUrl });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function getNetworkBadge(distance?: string) {
  switch (distance) {
    case "FIRST_DEGREE":
      return {
        label: "1er grado · Conectados",
        className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      };
    case "SECOND_DEGREE":
      return {
        label: "2do grado",
        className: "bg-[#0099ff]/20 text-[#70c4ff] border-[#0099ff]/30",
      };
    case "THIRD_DEGREE":
    case "OUT_OF_NETWORK":
      return {
        label: "3er grado",
        className: "bg-slate-500/20 text-slate-300 border-slate-500/30",
      };
    default:
      return {
        label: "Perfil LinkedIn",
        className: "bg-slate-500/20 text-slate-300 border-slate-500/30",
      };
  }
}

function ProfileVerifyCard({
  candidates,
  intendedAction,
  userContext,
  disabled,
  onConfirm,
  onReject,
}: {
  candidates: VerifiedPersonCandidate[];
  intendedAction: string;
  userContext: string;
  disabled: boolean;
  onConfirm: (person: VerifiedPersonCandidate) => void;
  onReject: (remaining: VerifiedPersonCandidate[]) => void;
}) {
  const [acted, setActed] = useState<"confirmed" | "rejected" | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const current = candidates[0];
  if (!current) return null;

  const remaining = candidates.slice(1);
  const badge = getNetworkBadge(current.networkDistance);
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
          Verificación de identidad
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
                title="Abrir perfil en LinkedIn"
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
          {acted === "confirmed"
            ? "✅ Identidad confirmada. Preparando propuesta..."
            : "❌ Perfil descartado."}
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
            Sí, es él
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
            {remaining.length > 0 ? `No, ver otro (${remaining.length})` : "No es él"}
          </button>
        </div>
      )}

      {!acted && intendedAction && userContext && (
        <p className="text-[10px] text-slate-400 px-0.5">
          No ejecutaré ninguna acción hasta que confirmes el perfil y apruebes el borrador.
        </p>
      )}
    </div>
  );
}

function ApprovalActionCard({
  initialApproval,
  disabled,
  onApprove,
  onSchedule,
  onDiscard,
}: {
  initialApproval: ApprovalActionPayload;
  disabled: boolean;
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
      ? { label: "Publicación de LinkedIn", icon: <FileText className="w-3.5 h-3.5 text-[#0099ff]" />, cta: "Publicar ahora" }
      : initialApproval.type === "connection"
        ? { label: "Solicitud de Conexión", icon: <UserPlus className="w-3.5 h-3.5 text-[#0099ff]" />, cta: "Enviar conexión" }
        : initialApproval.type === "comment"
          ? { label: "Comentario en Post", icon: <MessageSquarePlus className="w-3.5 h-3.5 text-[#0099ff]" />, cta: "Publicar comentario" }
          : { label: "Mensaje Directo / Propuesta", icon: <SendHorizonal className="w-3.5 h-3.5 text-[#0099ff]" />, cta: "Enviar mensaje" };

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
            Para: {initialApproval.targetName}
          </span>
        )}
      </div>

      {initialApproval.targetPostSnippet && (
        <div className="p-2 rounded-lg bg-black/35 border border-white/8 text-[11px] text-slate-400 italic line-clamp-2">
          Post original: “{initialApproval.targetPostSnippet}...”
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
            ✓ Guardar cambios en borrador
          </button>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-black/45 border border-white/8 text-xs text-slate-100 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
          {draftText}
        </div>
      )}

      {status !== "pending" ? (
        <div className="text-xs font-semibold pt-0.5 text-emerald-300">
          {status === "approved" && "✅ Aprobado y enviado a ejecución."}
          {status === "scheduled" && "📅 Agendado en tu calendario editorial."}
          {status === "discarded" && "🗑️ Borrador descartado."}
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
                Confirmar fecha
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
              {isEditing ? "Listo" : "Editar"}
            </button>

            {initialApproval.type === "post" && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setShowScheduler((prev) => !prev)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-[#70c4ff] bg-[#0099ff]/12 hover:bg-[#0099ff]/20 border border-[#0099ff]/25 transition cursor-pointer"
              >
                <Calendar className="w-3 h-3" />
                Agendar
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
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InhubBotAppPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [emotion, setEmotion] = useState<InHubEmotion>("idle");
  const [recognitionSupported, setRecognitionSupported] = useState(true);

  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  // Text to Speech
  const speakText = useCallback(
    (text: string) => {
      if (!voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const clean = text.replace(/[*_#`[\]()]/g, "").trim();
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.lang = "es-ES";
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
    [voiceEnabled]
  );

  // Send message to Bot API
  const handleSend = useCallback(
    async (
      customText?: string,
      explicitAction?: string,
      explicitPayload?: Record<string, unknown>,
      overrideImage?: PendingImage | null
    ) => {
      const textToSend = (customText !== undefined ? customText : inputValue).trim();
      const imageToSend = overrideImage !== undefined ? overrideImage : pendingImage;

      if (!textToSend && !explicitAction && !imageToSend) return;

      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (textToSend || imageToSend) {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            sender: "user",
            text: textToSend,
            imagePreviewUrl: imageToSend?.previewUrl,
            timestamp: time,
          },
        ]);
      }

      if (customText === undefined) setInputValue("");
      if (imageToSend) setPendingImage(null);
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
            imageBase64: imageToSend?.base64,
            imageMimeType: imageToSend?.mimeType,
            history: messagesRef.current.slice(-6).map((m) => ({
              sender: m.sender,
              text: m.text,
            })),
            locale: "es",
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
            quickActions: data.quickActions || DEFAULT_QUICK_ACTIONS,
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
              text: data.reply || "Ocurrió un error al procesar el comando.",
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
            text: "Error de conexión con el asistente. Inténtalo de nuevo.",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [inputValue, pendingImage, speakText, voiceEnabled]
  );

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // Initialize Speech Recognition once
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "es-ES";

        recognition.onstart = () => {
          setIsListening(true);
          setEmotion("thinking");
        };

        recognition.onresult = (event: any) => {
          const transcript = event.results[0]?.[0]?.transcript || "";
          if (transcript.trim()) {
            handleSendRef.current(transcript.trim());
          }
        };

        recognition.onerror = () => {
          setIsListening(false);
          setEmotion("idle");
        };

        recognition.onend = () => {
          setIsListening(false);
          setEmotion("idle");
        };

        recognitionRef.current = recognition;
      } else {
        setRecognitionSupported(false);
      }
    }
  }, []);

  // Welcome message on mount
  useEffect(() => {
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages([
      {
        id: "welcome-msg",
        sender: "bot",
        text: "Hola, soy **InhubBot**. Puedo controlar tu plataforma de Social Selling en LinkedIn por voz, texto o foto.\n\n• Sácale foto a un artículo de revista para modelar un post.\n• Pídeme buscar a un prospecto (verifico su foto y grado de conexión antes de actuar).\n• Nunca publico ni envío nada sin tu aprobación.",
        quickActions: DEFAULT_QUICK_ACTIONS,
        timestamp: now,
      },
    ]);
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      try {
        recognitionRef.current.start();
      } catch {
        recognitionRef.current.stop();
      }
    }
  };

  const handleImagePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToBase64(file);
      setPendingImage(compressed);
    } catch {
      // ignore invalid file
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleToggleCampaign = (campaignId: string, campaignName: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "paused" : "active";
    handleSend(
      `${newStatus === "active" ? "Activar" : "Pausar"} campaña ${campaignName}`,
      "toggle_campaign",
      { campaignId, campaignName, status: newStatus },
      null
    );
  };

  const handleClearChat = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setPendingImage(null);
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: "bot",
        text: "Conversación reiniciada. ¿Qué trabajo deseas que ejecute en tu LinkedIn hoy?",
        quickActions: DEFAULT_QUICK_ACTIONS,
        timestamp: now,
      },
    ]);
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
            src="/images/logo/inhubflow-icon-light.png"
            alt="InhubFlow"
            className="h-9 w-9 object-contain"
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
            title={voiceEnabled ? "Desactivar respuesta por voz" : "Activar respuesta por voz (TTS $0)"}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={handleClearChat}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition border border-white/8"
            title="Reiniciar conversación"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── GEMINI HERO (only shown before conversation starts) ── */}
      {messages.length <= 1 && !isSending && (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <h1 className="text-[28px] sm:text-4xl font-light text-white tracking-tight mb-1 text-center">
            ¡Hola!
          </h1>
          <p className="text-[18px] sm:text-lg font-light text-white text-center leading-snug mb-8">
            ¿En qué puedo ayudarte hoy?
          </p>

          <div className="relative mb-10">
            <div
              className="absolute inset-0 rounded-full blur-3xl"
              style={{
                background: "radial-gradient(circle, rgba(0,153,255,0.5) 0%, rgba(99,102,241,0.2) 50%, transparent 80%)",
                transform: "scale(2.5)",
              }}
            />
            <div
              className="absolute inset-0 rounded-full blur-xl"
              style={{
                background: "radial-gradient(circle, rgba(0,153,255,0.3) 0%, transparent 65%)",
                transform: "scale(1.8)",
              }}
            />
            <InHubLiveAvatar emotion={emotion} size="2xl" hideStatusDot />
          </div>

          <div className="w-full max-w-sm grid grid-cols-2 gap-2.5">
            {[
              { icon: <BarChart3 className="w-4 h-4" />, label: "Dame el resumen de hoy" },
              { icon: <Layers className="w-4 h-4" />, label: "¿Cómo van las campañas?" },
              { icon: <FileText className="w-4 h-4" />, label: "Crear post viral" },
              { icon: <Users className="w-4 h-4" />, label: "Últimos prospectos del radar" },
            ].map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(chip.label, undefined, undefined, null)}
                disabled={isSending || isListening}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl text-[13px] font-medium transition cursor-pointer text-left leading-snug disabled:opacity-50"
                style={{
                  background: "rgba(0,153,255,0.08)",
                  border: "1px solid rgba(0,153,255,0.2)",
                  color: "#a8d8f8",
                }}
              >
                <span className="text-[#0099ff] shrink-0">{chip.icon}</span>
                <span>{chip.label}</span>
              </button>
            ))}
          </div>
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
                        alt="Foto enviada"
                        className="rounded-xl max-h-52 object-cover border border-white/20"
                      />
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

                  {/* Interactive Cards */}
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
                              onConfirm={(person) =>
                                handleSend(
                                  `Sí, es ${person.name}`,
                                  "confirm_profile",
                                  { person, intendedAction, userContext },
                                  null
                                )
                              }
                              onReject={(remaining) =>
                                handleSend(
                                  "No es esa persona",
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
                              onApprove={(editedApproval) =>
                                handleSend(
                                  "Aprobado, ejecutar ahora",
                                  "approve_action",
                                  { approval: editedApproval },
                                  null
                                )
                              }
                              onSchedule={(editedApproval, scheduledAt) =>
                                handleSend(
                                  "Agendar publicación",
                                  "schedule_action",
                                  { approval: editedApproval, scheduledAt },
                                  null
                                )
                              }
                              onDiscard={() =>
                                handleSend("Descartar borrador", "discard_action", {}, null)
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
                                  Métricas Clave
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                                  En tiempo real
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">Prospectos CRM</span>
                                  <span className="text-lg font-bold text-white">{s.leads?.total || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">Alta Intención</span>
                                  <span className="text-lg font-bold text-emerald-400">{s.leads?.qualified || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">Campañas Activas</span>
                                  <span className="text-lg font-bold text-[#0099ff]">{s.campaigns?.active || 0} / {s.campaigns?.total || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg bg-white/5">
                                  <span className="text-[#5abaff] block text-[11px]">Posts Prog.</span>
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
                                  Secuencias Lineales
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
                                        <span className="text-[10px] text-[#5abaff]">Código: {camp.code}</span>
                                      </div>
                                      <button
                                        onClick={() => handleToggleCampaign(camp.id, camp.name, camp.status)}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                                          isActive
                                            ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                                            : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                        }`}
                                      >
                                        {isActive ? (<><PauseCircle className="w-3 h-3" /> Pausar</>) : (<><PlayCircle className="w-3 h-3" /> Activar</>)}
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
                                  {post.status === "scheduled" ? "Programado" : "Borrador"}
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
                                  Prospectos Calificados
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
                                <span className="font-semibold text-white">Estado de LinkedIn</span>
                              </div>
                              <div className="p-2 rounded-lg flex items-center justify-between bg-white/5">
                                <span className="text-[#5abaff]">Cuentas activas:</span>
                                <span className="font-bold text-white">{acc.active} / {acc.total}</span>
                              </div>
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
              InhubBot está procesando...
            </div>
          )}

          <div ref={chatEndRef} />
        </main>
      )}

      {/* Quick Action Chips */}
      {messages.length > 1 && (
        <div className="px-3 py-2 overflow-x-auto flex gap-2 no-scrollbar shrink-0 border-t border-[#0099ff]/12">
          {DEFAULT_QUICK_ACTIONS.map((chip, idx) => (
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

      {/* Voice Active Listening Notification Bar */}
      {isListening && (
        <div
          className="px-4 py-2 flex items-center justify-between text-white text-xs animate-pulse shrink-0"
          style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)" }}
        >
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4" />
            <span className="font-medium">Escuchando tu comando de voz en español...</span>
          </div>
          <button onClick={toggleListening} className="text-[11px] underline font-bold hover:text-blue-100">
            Detener
          </button>
        </div>
      )}

      {/* Bottom Command Input Bar */}
      <footer
        className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0 border-t border-[#0099ff]/12"
        style={{ background: "#000000" }}
      >
        {pendingImage && (
          <div className="max-w-4xl mx-auto mb-2.5 flex items-center gap-2.5 px-1">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImage.previewUrl}
                alt="Vista previa"
                className="w-14 h-14 rounded-xl object-cover border border-[#0099ff]/40"
              />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                aria-label="Quitar imagen"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black text-white border border-white/25 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <span className="text-xs text-[#70c4ff]">
              Foto lista. Indica qué quieres modelar o envía directamente.
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
          {/* Voice Button */}
          {recognitionSupported ? (
            <button
              type="button"
              onClick={toggleListening}
              className={`flex items-center justify-center w-11 h-11 rounded-2xl transition shadow-lg shrink-0 cursor-pointer ${
                isListening
                  ? "bg-red-500 text-white animate-bounce shadow-red-500/30"
                  : "text-white hover:opacity-90"
              }`}
              style={!isListening ? { background: "linear-gradient(135deg, #0099ff, #0070cc)", boxShadow: "0 4px 15px rgba(0,153,255,0.3)" } : {}}
              title={isListening ? "Detener escucha" : "Hablar con InhubBot (Voz $0)"}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          ) : (
            <div
              className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white/5 text-slate-500 shrink-0 border border-white/8"
              title="Reconocimiento de voz no soportado en este navegador"
            >
              <MicOff className="w-5 h-5" />
            </div>
          )}

          {/* Camera / Photo Upload Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending || isListening}
            className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white/6 text-[#70c4ff] hover:text-white hover:bg-[#0099ff]/20 border border-[#0099ff]/25 transition shrink-0 cursor-pointer disabled:opacity-40"
            title="Enviar foto de artículo o captura para modelar"
            aria-label="Adjuntar foto"
          >
            <Camera className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImagePicked}
          />

          {/* Text Input */}
          <div className="relative flex-1">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                isListening
                  ? "Escuchando..."
                  : pendingImage
                    ? "Ej: Modélalo para nuestra empresa y publícalo hoy..."
                    : "Escribe, habla o envía una foto..."
              }
              disabled={isSending || isListening}
              className="w-full h-11 px-4 rounded-2xl text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#0099ff] transition"
              style={{
                background: "rgba(0,153,255,0.08)",
                border: "1px solid rgba(0,153,255,0.25)",
              }}
            />
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={(!inputValue.trim() && !pendingImage) || isSending || isListening}
            className="flex items-center justify-center w-11 h-11 rounded-2xl text-white disabled:opacity-30 transition shadow-lg shrink-0 cursor-pointer"
            style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)", boxShadow: "0 4px 15px rgba(0,153,255,0.25)" }}
            title="Enviar mensaje"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </footer>
    </div>
  );
}
