"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { InHubLiveAvatar, type InHubEmotion } from "@/components/copilot/InHubLiveAvatar";
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
} from "lucide-react";

interface ActionCard {
  type: "summary" | "campaigns" | "post" | "leads" | "accounts";
  data: any;
}

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  cards?: ActionCard[];
  quickActions?: string[];
  timestamp: string;
}

const DEFAULT_QUICK_ACTIONS = [
  "Dame el resumen de hoy",
  "¿Cómo van las campañas?",
  "Crear post viral sobre ventas B2B",
  "Últimos prospectos del radar",
  "Estado de mi cuenta de LinkedIn",
];

export default function InhubBotAppPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [emotion, setEmotion] = useState<InHubEmotion>("idle");
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [speechActive, setSpeechActive] = useState(false);

  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize Speech Recognition
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
            handleSend(transcript.trim());
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
    const welcomeId = "welcome-msg";
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages([
      {
        id: welcomeId,
        sender: "bot",
        text: "Hola, soy **InhubBot**. Puedo controlar toda tu plataforma de Social Selling en LinkedIn mediante comandos de voz o texto.\n\nPuedes pedirme métricas, reportes del día, crear y programar publicaciones virales, gestionar tus campañas o revisar prospectos con intención de compra.",
        quickActions: DEFAULT_QUICK_ACTIONS,
        timestamp: now,
      },
    ]);
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

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

        utterance.onstart = () => {
          setSpeechActive(true);
          setEmotion("talking");
        };

        utterance.onend = () => {
          setSpeechActive(false);
          setEmotion("idle");
        };

        utterance.onerror = () => {
          setSpeechActive(false);
          setEmotion("idle");
        };

        window.speechSynthesis.speak(utterance);
      } catch {
        setSpeechActive(false);
      }
    },
    [voiceEnabled]
  );

  // Toggle Voice Recognition
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

  // Send message to Bot API
  const handleSend = async (customText?: string, explicitAction?: string, explicitPayload?: any) => {
    const textToSend = (customText !== undefined ? customText : inputValue).trim();
    if (!textToSend && !explicitAction) return;

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (textToSend) {
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          sender: "user",
          text: textToSend,
          timestamp: time,
        },
      ]);
    }

    setInputValue("");
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
  };

  // Toggle Campaign from interactive card
  const handleToggleCampaign = (campaignId: string, campaignName: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "paused" : "active";
    handleSend(
      `${newStatus === "active" ? "Activar" : "Pausar"} campaña ${campaignName}`,
      "toggle_campaign",
      { campaignId, campaignName, status: newStatus }
    );
  };

  const handleClearChat = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
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
      <header className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-[#0099ff]/15 backdrop-blur z-20"
        style={{ background: "rgba(0,0,0,0.85)" }}
      >
        <div className="flex items-center">
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
          {/* 1. Greeting text */}
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-1 text-center">
            ¡Hola!
          </h1>
          <p className="text-base sm:text-lg text-[#5abaff] text-center leading-snug mb-8">
            ¿En qué puedo ayudarte hoy?
          </p>

          {/* 2. Inhub bot avatar with radial glow */}
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

          {/* 3. Quick action chips (Gemini 2x2 grid) */}
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
                onClick={() => handleSend(chip.label)}
                disabled={isSending || isListening}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl text-[13px] font-medium transition cursor-pointer text-left leading-snug disabled:opacity-50"
                style={{
                  background: "rgba(0,153,255,0.08)",
                  border: "1px solid rgba(0,153,255,0.2)",
                  color: "#a8d8f8",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,153,255,0.18)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,153,255,0.45)";
                  (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,153,255,0.08)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,153,255,0.2)";
                  (e.currentTarget as HTMLButtonElement).style.color = "#a8d8f8";
                }}
              >
                <span className="text-[#0099ff] shrink-0">{chip.icon}</span>
                <span>{chip.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── CONVERSATION STREAM (shown when messages > 1) ── */}
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
                  className={`max-w-[90%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-md ${
                    isUser
                      ? "bg-[#0099ff] text-white rounded-br-xs"
                      : "text-slate-100 rounded-bl-xs"
                  }`}
                  style={!isUser ? { background: "rgba(0,153,255,0.08)", border: "1px solid rgba(0,153,255,0.15)" } : {}}
                >
                  {!isUser && (
                    <div className="flex items-center gap-2 mb-1.5 text-xs text-[#0099ff] font-medium">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>InhubBot</span>
                    </div>
                  )}

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

                  {/* Interactive Cards */}
                  {m.cards && m.cards.length > 0 && (
                    <div className="mt-3 space-y-3 pt-2 border-t border-[#0099ff]/15">
                      {m.cards.map((card, cidx) => {
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
                                <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
                                  <span className="text-[#5abaff] block text-[11px]">Prospectos CRM</span>
                                  <span className="text-lg font-bold text-white">{s.leads?.total || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
                                  <span className="text-[#5abaff] block text-[11px]">Alta Intención</span>
                                  <span className="text-lg font-bold text-emerald-400">{s.leads?.qualified || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
                                  <span className="text-[#5abaff] block text-[11px]">Campañas Activas</span>
                                  <span className="text-lg font-bold text-[#0099ff]">{s.campaigns?.active || 0} / {s.campaigns?.total || 0}</span>
                                </div>
                                <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
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
                            <div key={cidx} className="p-3 rounded-xl space-y-2"
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
                                    <div key={camp.id} className="flex items-center justify-between p-2 rounded-lg text-xs"
                                      style={{ background: "rgba(255,255,255,0.05)" }}
                                    >
                                      <div className="min-w-0 pr-2">
                                        <span className="font-medium text-white block truncate">{camp.name}</span>
                                        <span className="text-[10px] text-[#5abaff]">Código: {camp.code}</span>
                                      </div>
                                      <button
                                        onClick={() => handleToggleCampaign(camp.id, camp.name, camp.status)}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
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
                            <div key={cidx} className="p-3 rounded-xl space-y-2 text-xs"
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
                              <p className="text-slate-300 line-clamp-3 p-2 rounded-lg font-mono text-[11px]"
                                style={{ background: "rgba(255,255,255,0.05)" }}
                              >
                                {post.content}
                              </p>
                            </div>
                          );
                        }

                        if (card.type === "leads") {
                          const { leads } = card.data;
                          return (
                            <div key={cidx} className="p-3 rounded-xl space-y-2 text-xs"
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
                                  <div key={l.id} className="flex items-center justify-between p-2 rounded-lg text-xs"
                                    style={{ background: "rgba(255,255,255,0.05)" }}
                                  >
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
                            <div key={cidx} className="p-3 rounded-xl space-y-2 text-xs"
                              style={{ background: "rgba(0,153,255,0.06)", border: "1px solid rgba(0,153,255,0.15)" }}
                            >
                              <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-[#0099ff]" />
                                <span className="font-semibold text-white">Estado de LinkedIn</span>
                              </div>
                              <div className="p-2 rounded-lg flex items-center justify-between"
                                style={{ background: "rgba(255,255,255,0.05)" }}
                              >
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
              InhubBot está pensando...
            </div>
          )}

          <div ref={chatEndRef} />
        </main>
      )}

      {/* Quick Action Chips (shown after conversation starts) */}
      {messages.length > 1 && (
        <div className="px-3 py-2 overflow-x-auto flex gap-2 no-scrollbar shrink-0 border-t border-[#0099ff]/12">
          {DEFAULT_QUICK_ACTIONS.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(chip)}
              disabled={isSending || isListening}
              className="shrink-0 text-xs px-3 py-1.5 rounded-full transition disabled:opacity-50"
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
        <div className="px-4 py-2 flex items-center justify-between text-white text-xs animate-pulse shrink-0"
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 max-w-4xl mx-auto"
        >
          {/* Main Voice Button */}
          {recognitionSupported ? (
            <button
              type="button"
              onClick={toggleListening}
              className={`flex items-center justify-center w-11 h-11 rounded-2xl transition shadow-lg shrink-0 ${
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

          {/* Text Input */}
          <div className="relative flex-1">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={isListening ? "Escuchando..." : "Escribe, habla o comparte..."}
              disabled={isSending || isListening}
              className="w-full h-11 pl-4 pr-10 rounded-2xl text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#0099ff] transition"
              style={{
                background: "rgba(0,153,255,0.08)",
                border: "1px solid rgba(0,153,255,0.25)",
              }}
            />
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputValue.trim() || isSending || isListening}
            className="flex items-center justify-center w-11 h-11 rounded-2xl text-white disabled:opacity-30 transition shadow-lg shrink-0"
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
