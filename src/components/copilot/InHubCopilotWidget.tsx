"use client";

import type { CopilotAccountStatus } from "@/app/api/copilot/status/route";
import type { TrainingDraft, TrainingStep } from "@/app/api/copilot/chat/route";
import { usePathname } from "@/i18n/navigation";
import {
  getRouteCopilotContext,
  normalizeCopilotLocale,
  type CopilotActionLink,
  type CopilotLocale,
} from "@/lib/copilot/platform-manual";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  Mic,
  MicOff,
  Paperclip,
  Send,
  X,
  Pencil,
  Zap,
  MessageCircle,
  BarChart2,
} from "lucide-react";
import { useLocale } from "next-intl";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InHubLiveAvatar, type InHubEmotion } from "./InHubLiveAvatar";

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ApprovalData {
  type: "post" | "connection" | "comment" | "message";
  preview: string;
  target?: string;
}

interface ChatMessage {
  id: string;
  sender: "inhub" | "user";
  text: string;
  actions?: CopilotActionLink[];
  imageBase64?: string;
  imageMimeType?: string;
  /** If present, this is an approval-required bubble */
  approvalData?: ApprovalData;
  approvalReply?: string;
}

// SpeechRecognition types (not in all TS lib versions)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

// ─── LABELS ──────────────────────────────────────────────────────────────────

const UI_LABELS: Record<
  CopilotLocale,
  {
    assistantTitle: string;
    subtitlePrefix: string;
    stepLinkedIn: string;
    stepTrain: string;
    stepPosts: string;
    stepSignals: string;
    stepCampaigns: string;
    yesExplainBtn: string;
    startNowBtn: string;
    trainNowBtn: string;
    inputPlaceholder: string;
    trainingPlaceholder: string;
    typingText: string;
    onboardingMissingLinkedIn: string;
    onboardingMissingKnowledge: string;
    welcomeIntro: string;
  }
> = {
  es: {
    assistantTitle: "Inhub",
    subtitlePrefix: "Asistente IA",
    stepLinkedIn: "Conectar LinkedIn",
    stepTrain: "Entrenar empresa",
    stepPosts: "Crear posts",
    stepSignals: "Signal Radar",
    stepCampaigns: "Campañas",
    yesExplainBtn: "Explícame esta sección →",
    startNowBtn: "Conectar LinkedIn →",
    trainNowBtn: "Entrenar ahora →",
    inputPlaceholder: "Escribe tu pregunta...",
    trainingPlaceholder: "Escribe tu respuesta...",
    typingText: "Escribiendo...",
    onboardingMissingLinkedIn:
      "Hola, soy Inhub. Primero conecta tu cuenta de LinkedIn para empezar.",
    onboardingMissingKnowledge:
      "LinkedIn listo. ¿Me entrenas en 1 minuto con los datos de tu empresa?",
    welcomeIntro:
      "Hola, soy **Inhub**. Puedo ayudarte a configurar tu cuenta o explicarte cómo usar cualquier sección.",
  },
  en: {
    assistantTitle: "Inhub",
    subtitlePrefix: "AI Assistant",
    stepLinkedIn: "Connect LinkedIn",
    stepTrain: "Train company",
    stepPosts: "Create posts",
    stepSignals: "Signal Radar",
    stepCampaigns: "Campaigns",
    yesExplainBtn: "Explain this section →",
    startNowBtn: "Connect LinkedIn →",
    trainNowBtn: "Train now →",
    inputPlaceholder: "Ask anything...",
    trainingPlaceholder: "Type your answer...",
    typingText: "Typing...",
    onboardingMissingLinkedIn:
      "Hi, I'm Inhub. Connect your LinkedIn account first to get started.",
    onboardingMissingKnowledge:
      "LinkedIn is ready. Want to train me on your company in 1 minute?",
    welcomeIntro:
      "Hi, I'm **Inhub**. I can help you set up your account or walk you through any section.",
  },
  "pt-BR": {
    assistantTitle: "Inhub",
    subtitlePrefix: "Assistente IA",
    stepLinkedIn: "Conectar LinkedIn",
    stepTrain: "Treinar empresa",
    stepPosts: "Criar posts",
    stepSignals: "Signal Radar",
    stepCampaigns: "Campanhas",
    yesExplainBtn: "Explicar esta seção →",
    startNowBtn: "Conectar LinkedIn →",
    trainNowBtn: "Treinar agora →",
    inputPlaceholder: "Digite sua pergunta...",
    trainingPlaceholder: "Digite sua resposta...",
    typingText: "Digitando...",
    onboardingMissingLinkedIn:
      "Olá, sou o Inhub. Primeiro conecte sua conta do LinkedIn para começar.",
    onboardingMissingKnowledge:
      "LinkedIn pronto. Quer me treinar em 1 minuto com os dados da sua empresa?",
    welcomeIntro:
      "Olá, sou o **Inhub**. Posso ajudar a configurar sua conta ou explicar qualquer seção da plataforma.",
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function renderFormattedText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={lineIdx}>
        {lineIdx > 0 && <br />}
        {parts.map((part, partIdx) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={partIdx} className="font-semibold text-slate-900 dark:text-white">
                {part.slice(2, -2)}
              </strong>
            );
          }
          return <span key={partIdx}>{part}</span>;
        })}
      </React.Fragment>
    );
  });
}

// ─── APPROVAL BUBBLE COMPONENT ───────────────────────────────────────────────

interface ApprovalBubbleProps {
  approvalData: ApprovalData;
  approvalReply?: string;
  onApprove: () => void;
  onEdit: (text: string) => void;
  onSchedule: (date: string) => void;
  onDiscard: () => void;
}

function ApprovalBubble({ approvalData, approvalReply, onApprove, onEdit, onSchedule, onDiscard }: ApprovalBubbleProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [acted, setActed] = useState(false);

  const typeLabels: Record<ApprovalData["type"], string> = {
    post: "📝 Post",
    connection: "🤝 Solicitud de conexión",
    comment: "💬 Comentario",
    message: "✉️ Mensaje",
  };

  if (acted && approvalReply) {
    return (
      <div className="text-[11px] text-gray-400 italic px-1 mt-1">{approvalReply}</div>
    );
  }

  return (
    <div
      className="rounded-2xl rounded-bl-sm px-3.5 py-3 max-w-[94%] text-[12px] leading-relaxed space-y-2.5"
      style={{
        background: "rgba(0,20,50,0.85)",
        border: "1.5px solid rgba(0,153,255,0.45)",
        boxShadow: "0 0 18px rgba(0,153,255,0.12)",
      }}
    >
      {/* Type badge */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-[#0099ff] uppercase">
          {typeLabels[approvalData.type]}
        </span>
        {approvalData.target && (
          <span className="text-[10px] text-gray-400">→ {approvalData.target}</span>
        )}
      </div>

      {/* Preview text */}
      <div
        className="text-gray-200 text-[11.5px] leading-relaxed rounded-xl px-3 py-2.5 whitespace-pre-wrap"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {approvalData.preview}
      </div>

      {/* Date picker inline */}
      {showDatePicker && (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="flex-1 rounded-lg px-2 py-1.5 text-[11px] text-white bg-white/10 border border-[#0099ff]/30 focus:outline-none focus:border-[#0099ff]"
          />
          <button
            type="button"
            onClick={() => {
              if (scheduledDate) {
                setActed(true);
                onSchedule(scheduledDate);
              }
            }}
            className="px-2.5 py-1.5 rounded-lg bg-[#0099ff] text-white text-[10px] font-bold transition hover:bg-[#007acc] cursor-pointer"
          >
            OK
          </button>
        </div>
      )}

      {/* Action buttons */}
      {!acted && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => { setActed(true); onApprove(); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10.5px] font-semibold transition cursor-pointer"
            style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }}
          >
            ✅ Aprobar
          </button>
          <button
            type="button"
            onClick={() => { setActed(true); onEdit(approvalData.preview); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10.5px] font-semibold transition cursor-pointer"
            style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.35)", color: "#fbbf24" }}
          >
            ✏️ Editar
          </button>
          <button
            type="button"
            onClick={() => setShowDatePicker((p) => !p)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10.5px] font-semibold transition cursor-pointer"
            style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.35)", color: "#a5b4fc" }}
          >
            <Calendar className="w-3 h-3" /> Agendar
          </button>
          <button
            type="button"
            onClick={() => { setActed(true); onDiscard(); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10.5px] font-semibold transition cursor-pointer"
            style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
          >
            🗑️ Descartar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MAIN WIDGET ─────────────────────────────────────────────────────────────

export default function InHubCopilotWidget() {
  const rawLocale = useLocale();
  const locale = normalizeCopilotLocale(rawLocale);
  const pathname = usePathname() || "/";
  const labels = UI_LABELS[locale];

  const routeCtx = useMemo(
    () => getRouteCopilotContext(pathname, locale),
    [pathname, locale]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [showProgressMenu, setShowProgressMenu] = useState(false);
  const [showProactiveBubble, setShowProactiveBubble] = useState(false);
  const [dismissedRoutes, setDismissedRoutes] = useState<Record<string, boolean>>({});
  const [accountStatus, setAccountStatus] = useState<CopilotAccountStatus | null>(null);
  const [emotion, setEmotion] = useState<InHubEmotion>("idle");
  const [isSending, setIsSending] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [trainingStep, setTrainingStep] = useState<TrainingStep>("idle");
  const [trainingDraft, setTrainingDraft] = useState<TrainingDraft>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // ── Feature 1: STT ──
  const [isListening, setIsListening] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // ── Feature 2: Image input ──
  const [pendingImage, setPendingImage] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Drag ──
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    hasMoved: boolean;
  } | null>(null);

  // ── Check STT support ──
  useEffect(() => {
    if (typeof window !== "undefined") {
      const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      setSttSupported(supported);
    }
  }, []);

  // ── Load saved position ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("inhubflow_bot_position");
      if (saved) {
        const parsed = JSON.parse(saved) as { x?: unknown; y?: unknown };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          const maxX = Math.max(8, window.innerWidth - 110);
          const maxY = Math.max(8, window.innerHeight - 110);
          setPosition({
            x: Math.min(Math.max(8, parsed.x), maxX),
            y: Math.min(Math.max(8, parsed.y), maxY),
          });
        }
      }
    } catch {}
  }, []);

  // ── Drag handlers ──
  const handleBotPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const el = widgetRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      hasMoved: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const dx = moveEvent.clientX - state.startX;
      const dy = moveEvent.clientY - state.startY;

      if (!state.hasMoved && Math.hypot(dx, dy) > 5) {
        state.hasMoved = true;
        setIsDragging(true);
      }

      if (state.hasMoved) {
        const width = el.offsetWidth || 96;
        const height = el.offsetHeight || 96;
        const nextX = Math.min(Math.max(8, state.originX + dx), Math.max(8, window.innerWidth - width - 8));
        const nextY = Math.min(Math.max(8, state.originY + dy), Math.max(8, window.innerHeight - height - 8));
        setPosition({ x: nextX, y: nextY });
      }
    };

    const handlePointerUp = () => {
      const state = dragStateRef.current;
      if (state?.hasMoved) {
        setPosition((curr) => {
          if (curr) {
            try {
              localStorage.setItem("inhubflow_bot_position", JSON.stringify(curr));
            } catch {}
          }
          return curr;
        });
        setTimeout(() => {
          setIsDragging(false);
        }, 50);
      }
      dragStateRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, []);

  const fetchAccountStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/copilot/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as CopilotAccountStatus;
      if (data?.ok) {
        setAccountStatus(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchAccountStatus();
  }, [fetchAccountStatus, pathname]);

  // Clean welcome message once on mount
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: "welcome-0",
          sender: "inhub",
          text: labels.welcomeIntro,
        },
      ];
    });
  }, [labels.welcomeIntro]);

  // Show proactive bubble when entering new section
  useEffect(() => {
    if (isOpen || dismissedRoutes[routeCtx.routeKey]) {
      setShowProactiveBubble(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowProactiveBubble(true);
    }, 1400);

    return () => clearTimeout(timer);
  }, [routeCtx.routeKey, isOpen, dismissedRoutes]);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isSending]);

  // ── Feature 1: STT toggle ──
  const toggleListening = useCallback(() => {
    if (!sttSupported) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = locale === "en" ? "en-US" : locale === "pt-BR" ? "pt-BR" : "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setInputValue((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, sttSupported, locale]);

  // ── Feature 2: Handle file selection ──
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      // result is data:mimeType;base64,XXXX
      const [header, base64] = result.split(",");
      const mimeType = header.split(":")[1]?.split(";")[0] ?? file.type;
      setPendingImage({
        base64,
        mimeType,
        previewUrl: result,
      });
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // ── Send message (extended with image + approval support) ──
  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        triggerAction?: "start_training" | "check_account";
        imageBase64?: string;
        imageMimeType?: string;
      }
    ) => {
      const trimmed = text.trim();
      const hasImage = !!(options?.imageBase64);
      if (!trimmed && !options?.triggerAction && !hasImage) return;

      setIsOpen(true);
      setShowProactiveBubble(false);
      setShowProgressMenu(false);

      // Add user message bubble
      if (trimmed || hasImage) {
        setMessages((prev) => [
          ...prev,
          {
            id: `u-${Date.now()}`,
            sender: "user",
            text: trimmed,
            imageBase64: options?.imageBase64,
            imageMimeType: options?.imageMimeType,
          },
        ]);
      }

      setInputValue("");
      setPendingImage(null);
      setIsSending(true);
      setEmotion("thinking");

      try {
        const res = await fetch("/api/copilot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            pathname,
            locale,
            trainingStep,
            trainingDraft,
            triggerAction: options?.triggerAction,
            imageBase64: options?.imageBase64,
            imageMimeType: options?.imageMimeType,
            history: messagesRef.current.slice(-6).map((m) => ({
              role: m.sender === "user" ? "user" : "model",
              text: m.text,
            })),
          }),
        });

        const data = await res.json();
        if (data?.ok) {
          setTrainingStep(data.trainingStep || "idle");
          setTrainingDraft(data.trainingDraft || {});
          setEmotion((data.emotion as InHubEmotion) || "talking");

          // ── Feature 3: approval bubble ──
          if (data.approvalRequired && data.approvalData) {
            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now()}`,
                sender: "inhub",
                text: data.reply,
                actions: [],
                approvalData: data.approvalData as ApprovalData,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now()}`,
                sender: "inhub",
                text: data.reply,
                actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
              },
            ]);
          }

          if (data.knowledgeSaved) {
            fetchAccountStatus();
          }

          setTimeout(() => setEmotion("idle"), 1800);
        }
      } catch {
        setEmotion("idle");
      } finally {
        setIsSending(false);
      }
    },
    [pathname, locale, trainingStep, trainingDraft, fetchAccountStatus]
  );

  const handleSendWithImage = useCallback(() => {
    if (pendingImage) {
      sendMessage(inputValue, {
        imageBase64: pendingImage.base64,
        imageMimeType: pendingImage.mimeType,
      });
    } else {
      sendMessage(inputValue);
    }
  }, [inputValue, pendingImage, sendMessage]);

  const handleActionClick = (act: CopilotActionLink) => {
    if (act.actionType === "start_training" || act.href === "#train") {
      sendMessage(labels.trainNowBtn.replace(" →", ""), {
        triggerAction: "start_training",
      });
    }
  };

  const handleDismissBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowProactiveBubble(false);
    setDismissedRoutes((prev) => ({ ...prev, [routeCtx.routeKey]: true }));
  };

  // ── Approval actions ──
  const handleApprove = useCallback((msgId: string) => {
    // Mark message as acted
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, approvalReply: "✅ Aprobado. Procediendo..." } : m
      )
    );
    sendMessage("Aprobado, procede");
  }, [sendMessage]);

  const handleEditApproval = useCallback((preview: string) => {
    setInputValue(preview);
    setIsOpen(true);
  }, []);

  const handleScheduleApproval = useCallback((msgId: string, date: string) => {
    const formatted = new Date(date).toLocaleString(locale === "en" ? "en-US" : locale === "pt-BR" ? "pt-BR" : "es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, approvalReply: `📅 Agendado para ${formatted}` } : m
      )
    );
    sendMessage(`Agenda para ${formatted}`);
  }, [sendMessage, locale]);

  const handleDiscardApproval = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, approvalReply: "🗑️ Descartado." } : m
      )
    );
    sendMessage("De acuerdo, cancelado.");
  }, [sendMessage]);

  const proactiveConfig = useMemo(() => {
    if (accountStatus && !accountStatus.hasLinkedInAccount && routeCtx.routeKey === "dashboard") {
      return {
        text: labels.onboardingMissingLinkedIn,
        ctaLabel: labels.yesExplainBtn,
        onCta: () => {
          setShowProactiveBubble(false);
          sendMessage(labels.startNowBtn.replace(" →", ""));
        },
      };
    }

    if (
      accountStatus &&
      accountStatus.hasLinkedInAccount &&
      !accountStatus.hasCustomKnowledge &&
      (routeCtx.routeKey === "dashboard" || routeCtx.routeKey === "linkedin-accounts")
    ) {
      return {
        text: labels.onboardingMissingKnowledge,
        ctaLabel: labels.trainNowBtn,
        onCta: () => {
          sendMessage(labels.trainNowBtn.replace(" →", ""), {
            triggerAction: "start_training",
          });
        },
      };
    }

    return {
      text: routeCtx.proactiveBubble,
      ctaLabel: labels.yesExplainBtn,
      onCta: () => {
        sendMessage(routeCtx.quickChips[0] || "¿Cómo funciona esta sección?");
      },
    };
  }, [accountStatus, routeCtx, labels, sendMessage]);

  const hasPendingOnboarding =
    accountStatus !== null &&
    (!accountStatus.hasLinkedInAccount || !accountStatus.hasCustomKnowledge);

  const checklistItems = accountStatus
    ? [
        {
          label: labels.stepLinkedIn,
          done: accountStatus.hasLinkedInAccount,
          onClick: () => sendMessage(
            locale === "en" ? "How do I connect my LinkedIn account?"
            : locale === "pt-BR" ? "Como conecto minha conta do LinkedIn?"
            : "¿Cómo conecto mi cuenta de LinkedIn?"
          ),
        },
        {
          label: labels.stepTrain,
          done: accountStatus.hasCustomKnowledge,
          onClick: () =>
            sendMessage(labels.trainNowBtn.replace(" →", ""), {
              triggerAction: "start_training",
            }),
        },
        {
          label: labels.stepPosts,
          done: accountStatus.viralPostsCount > 0,
          onClick: () => sendMessage(
            locale === "en" ? "How do I create a viral post?"
            : locale === "pt-BR" ? "Como crio um post viral?"
            : "¿Cómo creo un post viral?"
          ),
        },
        {
          label: labels.stepSignals,
          done: accountStatus.signalMonitorsCount > 0,
          onClick: () => sendMessage(
            locale === "en" ? "How does Signal Radar work?"
            : locale === "pt-BR" ? "Como funciona o Signal Radar?"
            : "¿Cómo funciona el Signal Radar?"
          ),
        },
        {
          label: labels.stepCampaigns,
          done: accountStatus.campaignsCount > 0,
          onClick: () => sendMessage(
            locale === "en" ? "How do I create a campaign?"
            : locale === "pt-BR" ? "Como crio uma campanha?"
            : "¿Cómo creo una campaña?"
          ),
        },
      ]
    : [];

  return (
    <div
      ref={widgetRef}
      style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
      className={`fixed z-[999999] flex flex-col items-end ${
        position ? "" : "bottom-3 right-3"
      }`}
    >
      {/* ===================================================================== */}
      {/* 1. GEMINI-STYLE DARK CHAT PANEL                                       */}
      {/* ===================================================================== */}
      {isOpen && (
        <div className="mb-2.5 w-[340px] sm:w-[380px] max-h-[min(600px,calc(100dvh-160px))] rounded-3xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-3 duration-200 shadow-2xl shadow-black/40"
          style={{ background: "linear-gradient(170deg, #0a1628 0%, #0d1f3c 55%, #061020 100%)", border: "1px solid rgba(0,153,255,0.18)" }}
        >
          {/* ── TOP BAR ── */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-widest text-[#0099ff] uppercase">InhubFlow</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              {accountStatus && (
                <button
                  type="button"
                  onClick={() => setShowProgressMenu((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-[#0099ff] transition cursor-pointer border border-[#0099ff]/25 hover:bg-[#0099ff]/10"
                >
                  <span>{accountStatus.completedStepsCount}/{accountStatus.totalStepsCount}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showProgressMenu ? "rotate-180" : ""}`} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Cerrar"
                className="p-1.5 rounded-full text-gray-500 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── PROGRESS CHECKLIST (collapsible) ── */}
          {showProgressMenu && checklistItems.length > 0 && (
            <div className="mx-4 mb-2 rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
              {checklistItems.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={item.onClick}
                  className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/8 text-xs transition cursor-pointer text-left border-b border-white/5 last:border-0"
                >
                  <span className="flex items-center gap-2 text-gray-200">
                    {item.done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    )}
                    <span className={item.done ? "line-through text-gray-500" : "font-medium"}>{item.label}</span>
                  </span>
                  {!item.done && <span className="text-[11px] font-bold text-[#0099ff]">→</span>}
                </button>
              ))}
            </div>
          )}

          {/* ── GEMINI HERO ── */}
          {messages.length <= 1 && !isSending && (
            <div className="flex flex-col items-center pt-5 pb-4 px-4 shrink-0">
              <h2 className="text-[22px] font-bold text-white tracking-tight mb-0.5 text-center">
                {locale === "pt-BR" ? "Olá!" : locale === "en" ? "Hello!" : "¡Hola!"}
              </h2>
              <p className="text-sm text-[#5abaff] text-center leading-snug mb-6">
                {locale === "pt-BR"
                  ? "Como posso ajudar você hoje?"
                  : locale === "en"
                  ? "How can I help you today?"
                  : "¿En qué puedo ayudarte hoy?"}
              </p>

              <div className="relative mb-6">
                <div
                  className="absolute inset-0 rounded-full blur-3xl"
                  style={{
                    background: "radial-gradient(circle, rgba(0,153,255,0.45) 0%, rgba(0,153,255,0.12) 55%, transparent 80%)",
                    transform: "scale(2.2)",
                  }}
                />
                <div
                  className="absolute inset-0 rounded-full blur-xl"
                  style={{
                    background: "radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)",
                    transform: "scale(1.7)",
                  }}
                />
                <InHubLiveAvatar emotion={emotion} size="xl" hideStatusDot />
              </div>
            </div>
          )}

          {/* ── MESSAGES AREA ── */}
          {messages.length > 1 && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                >
                  {msg.sender === "inhub" && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <InHubLiveAvatar emotion={emotion} size="sm" hideStatusDot />
                    </div>
                  )}

                  {/* Approval bubble (Feature 3) */}
                  {msg.sender === "inhub" && msg.approvalData ? (
                    <div className="flex flex-col gap-1.5 max-w-[94%]">
                      {msg.text && (
                        <div className="text-[12px] text-gray-300 leading-relaxed mb-1">
                          {renderFormattedText(msg.text)}
                        </div>
                      )}
                      <ApprovalBubble
                        approvalData={msg.approvalData}
                        approvalReply={msg.approvalReply}
                        onApprove={() => handleApprove(msg.id)}
                        onEdit={handleEditApproval}
                        onSchedule={(date) => handleScheduleApproval(msg.id, date)}
                        onDiscard={() => handleDiscardApproval(msg.id)}
                      />
                    </div>
                  ) : (
                    <>
                      {/* Image preview in user bubble (Feature 2) */}
                      {msg.imageBase64 && (
                        <div className="mb-1 max-w-[88%]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`data:${msg.imageMimeType};base64,${msg.imageBase64}`}
                            alt="Imagen adjunta"
                            className="rounded-xl max-h-40 object-cover border border-white/10"
                          />
                        </div>
                      )}
                      {(msg.text || msg.sender === "inhub") && (
                        <div
                          className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                            msg.sender === "user"
                              ? "bg-[#0099ff] text-white rounded-br-sm"
                              : "bg-white/8 text-gray-200 border border-white/10 rounded-bl-sm"
                          }`}
                        >
                          {msg.sender === "inhub" ? renderFormattedText(msg.text) : msg.text}
                        </div>
                      )}
                      {msg.sender === "inhub" && msg.actions && msg.actions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5 max-w-[90%]">
                          {msg.actions.map((act, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleActionClick(act)}
                              className="px-2.5 py-1 rounded-full bg-white/5 text-[#0099ff] border border-[#0099ff]/30 hover:bg-[#0099ff]/15 text-[11px] font-semibold transition cursor-pointer"
                            >
                              {act.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {isSending && (
                <div className="flex items-center gap-2 text-[11px] text-gray-500 px-1">
                  <span className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-[#0099ff]/60 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-[#0099ff]/60 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[#0099ff]/60 rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  {labels.typingText}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* ── QUICK-ACTION CHIPS ── */}
          {messages.length <= 1 && trainingStep === "idle" && !isSending && (
            <div className="px-4 pb-4 grid grid-cols-2 gap-2 shrink-0">
              {[
                { icon: <Pencil className="w-3.5 h-3.5" />, label: routeCtx.quickChips[0] || (locale === "en" ? "Explain section" : locale === "pt-BR" ? "Explicar seção" : "Explicar sección") },
                { icon: <Zap className="w-3.5 h-3.5" />, label: routeCtx.quickChips[1] || (locale === "en" ? "Quick tips" : locale === "pt-BR" ? "Dicas rápidas" : "Tips rápidos") },
                { icon: <MessageCircle className="w-3.5 h-3.5" />, label: routeCtx.quickChips[2] || (locale === "en" ? "Best practices" : locale === "pt-BR" ? "Boas práticas" : "Buenas prácticas") },
                { icon: <BarChart2 className="w-3.5 h-3.5" />, label: locale === "en" ? "Show my progress" : locale === "pt-BR" ? "Ver meu progresso" : "Ver mi progreso" },
              ].map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => idx === 3 ? setShowProgressMenu(true) : sendMessage(chip.label)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-2xl text-[11px] font-medium transition cursor-pointer text-left leading-snug"
                  style={{
                    background: "rgba(0,153,255,0.07)",
                    border: "1px solid rgba(0,153,255,0.2)",
                    color: "#a8d8f8",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,153,255,0.16)";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,153,255,0.45)";
                    (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,153,255,0.07)";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,153,255,0.2)";
                    (e.currentTarget as HTMLButtonElement).style.color = "#a8d8f8";
                  }}
                >
                  <span className="text-[#0099ff] shrink-0">{chip.icon}</span>
                  <span className="line-clamp-2">{chip.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* ── INPUT BAR (Feature 1 + 2 integrated) ── */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendWithImage();
            }}
            className="shrink-0 px-3 pb-4"
          >
            {/* Image thumbnail preview */}
            {pendingImage && (
              <div className="mb-2 flex items-center gap-2 px-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pendingImage.previewUrl}
                  alt="Preview"
                  className="w-12 h-12 rounded-xl object-cover border border-[#0099ff]/30"
                />
                <button
                  type="button"
                  onClick={() => setPendingImage(null)}
                  className="p-1 rounded-full bg-white/10 text-gray-400 hover:text-white hover:bg-white/20 transition cursor-pointer"
                  aria-label="Quitar imagen"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <div
              className="flex items-center gap-2 rounded-full px-3 py-2.5"
              style={{ background: "rgba(0,153,255,0.08)", border: "1px solid rgba(0,153,255,0.25)" }}
            >
              {/* Feature 1: Mic button */}
              {sttSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  aria-label={isListening ? "Detener grabación" : "Grabar voz"}
                  title={isListening ? "Escuchando..." : "Hablar"}
                  className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition cursor-pointer ${
                    isListening
                      ? "bg-red-500/20 text-red-400 animate-pulse"
                      : "text-[#4a7fa0] hover:text-[#0099ff] hover:bg-[#0099ff]/10"
                  }`}
                >
                  {isListening ? (
                    <MicOff className="w-3.5 h-3.5" />
                  ) : (
                    <Mic className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              {/* Feature 2: Attach button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Adjuntar imagen"
                title="Adjuntar imagen, video o PDF"
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#4a7fa0] hover:text-[#0099ff] hover:bg-[#0099ff]/10 transition cursor-pointer"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.pdf"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Text input */}
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={
                  isListening
                    ? "Escuchando..."
                    : trainingStep !== "idle"
                    ? labels.trainingPlaceholder
                    : locale === "en"
                    ? "Type, talk or share..."
                    : locale === "pt-BR"
                    ? "Digite, fale ou compartilhe..."
                    : "Escribe, habla o comparte..."
                }
                className="flex-1 bg-transparent text-white placeholder-[#4a7fa0] text-xs focus:outline-none"
              />

              {/* Send button */}
              <button
                type="submit"
                disabled={(!inputValue.trim() && !pendingImage) || isSending}
                aria-label="Enviar"
                className="w-8 h-8 rounded-full text-white flex items-center justify-center transition cursor-pointer shrink-0 disabled:opacity-30"
                style={{ background: "linear-gradient(135deg, #0099ff, #0070cc)" }}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* STT listening indicator */}
            {isListening && (
              <div className="mt-1.5 flex items-center gap-1.5 px-4">
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-ping" />
                <span className="text-[10px] text-red-400 font-medium">Escuchando...</span>
              </div>
            )}
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. SPEECH BUBBLE + FLOATING INHUB AVATAR                              */}
      {/* ===================================================================== */}
      <div className="flex items-end gap-2.5">
        {showProactiveBubble && !isOpen && (
          <div
            onClick={proactiveConfig.onCta}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") proactiveConfig.onCta();
            }}
            className="relative max-w-[200px] rounded-xl rounded-br-sm bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800 px-3 py-2 shadow-md shadow-slate-900/10 cursor-pointer hover:border-[#0099ff]/40 transition animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <button
              type="button"
              onClick={handleDismissBubble}
              aria-label="Cerrar"
              className="absolute top-1.5 right-1.5 p-0.5 rounded-md text-slate-300 hover:text-slate-600 dark:hover:text-white transition cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
            <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-snug pr-3.5">
              {proactiveConfig.text}
            </p>
            <span className="mt-1 inline-block text-[10px] font-semibold text-[#0099ff]">
              {proactiveConfig.ctaLabel}
            </span>
          </div>
        )}

        <InHubLiveAvatar
          emotion={emotion}
          size="2xl"
          hasNotification={hasPendingOnboarding}
          isDragging={isDragging}
          onPointerDown={handleBotPointerDown}
          onClick={() => {
            if (dragStateRef.current?.hasMoved) return;
            setIsOpen((prev) => !prev);
          }}
        />
      </div>
    </div>
  );
}
