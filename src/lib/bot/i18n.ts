import { normalizeCopilotLocale, type CopilotLocale } from "@/lib/copilot/platform-manual";

export type BotLocale = CopilotLocale;

export function getBotLocale(raw?: string): BotLocale {
  return normalizeCopilotLocale(raw);
}

export function getSpeechLang(locale: BotLocale): string {
  if (locale === "en") return "en-US";
  if (locale === "pt-BR") return "pt-BR";
  return "es-ES";
}

export function getLocaleDisplayName(locale: BotLocale): string {
  if (locale === "en") return "English";
  if (locale === "pt-BR") return "Português do Brasil";
  return "Español";
}

export interface BotUiLabels {
  greetingTitle: string;
  greetingSubtitle: string;
  welcomeMessage: string;
  resetMessage: string;
  heroChips: [string, string, string, string];
  quickActions: string[];
  processingText: string;
  listeningBanner: string;
  stopListeningBtn: string;
  inputListeningPlaceholder: string;
  inputImagePlaceholder: string;
  inputDefaultPlaceholder: string;
  imageReadyHint: string;
  voiceEnableTitle: string;
  voiceDisableTitle: string;
  resetChatTitle: string;
  micStartTitle: string;
  micStopTitle: string;
  micUnsupportedTitle: string;
  cameraTitle: string;
  sendTitle: string;
  connectionError: string;
  genericError: string;
  // Verify card
  verifyTitle: string;
  degree1: string;
  degree2: string;
  degree3: string;
  degreeUnknown: string;
  confirmYes: string;
  confirmNo: string;
  confirmSeeOther: (count: number) => string;
  confirmedStatus: string;
  rejectedStatus: string;
  verifySafetyNote: string;
  // Approval card
  typePost: string;
  typeConnection: string;
  typeComment: string;
  typeMessage: string;
  ctaPost: string;
  ctaConnection: string;
  ctaComment: string;
  ctaMessage: string;
  forLabel: string;
  originalPostLabel: string;
  saveDraftChanges: string;
  editBtn: string;
  doneEditBtn: string;
  scheduleBtn: string;
  confirmDateBtn: string;
  discardBtn: string;
  statusApproved: string;
  statusScheduled: string;
  statusDiscarded: string;
  // Summary & data cards
  keyMetrics: string;
  realtimeBadge: string;
  crmLeads: string;
  highIntent: string;
  activeCampaigns: string;
  scheduledPosts: string;
  linearSequences: string;
  codeLabel: string;
  pauseBtn: string;
  activateBtn: string;
  scheduledBadge: string;
  draftBadge: string;
  qualifiedLeads: string;
  linkedinStatus: string;
  activeAccountsLabel: string;
  activateVerb: string;
  pauseVerb: string;
  campaignToggleLabel: (activate: boolean, name: string) => string;
  confirmPersonLabel: (name: string) => string;
  rejectPersonLabel: string;
  approveCmdLabel: string;
  scheduleCmdLabel: string;
  discardCmdLabel: string;
}

export const BOT_UI_LABELS: Record<BotLocale, BotUiLabels> = {
  es: {
    greetingTitle: "¡Hola!",
    greetingSubtitle: "¿En qué puedo ayudarte hoy?",
    welcomeMessage:
      "Hola, soy **InhubBot**. Puedo controlar tu plataforma de Social Selling en LinkedIn por voz, texto o foto.\n\n• Sácale foto a un artículo de revista para modelar un post.\n• Pídeme buscar a un prospecto (verifico su foto y grado de conexión antes de actuar).\n• Nunca publico ni envío nada sin tu aprobación.",
    resetMessage: "Conversación reiniciada. ¿Qué trabajo deseas que ejecute en tu LinkedIn hoy?",
    heroChips: [
      "Dame el resumen de hoy",
      "¿Cómo van las campañas?",
      "Crear post viral",
      "Últimos prospectos del radar",
    ],
    quickActions: [
      "Dame el resumen de hoy",
      "¿Cómo van las campañas?",
      "Crear post viral sobre ventas B2B",
      "Últimos prospectos del radar",
      "Estado de mi cuenta de LinkedIn",
    ],
    processingText: "InhubBot está procesando...",
    listeningBanner: "Escuchando tu comando de voz en español...",
    stopListeningBtn: "Detener",
    inputListeningPlaceholder: "Escuchando...",
    inputImagePlaceholder: "Ej: Modélalo para nuestra empresa y publícalo hoy...",
    inputDefaultPlaceholder: "Escribe, habla o envía una foto...",
    imageReadyHint: "Foto lista. Indica qué quieres modelar o envía directamente.",
    voiceEnableTitle: "Activar respuesta por voz (TTS $0)",
    voiceDisableTitle: "Desactivar respuesta por voz",
    resetChatTitle: "Reiniciar conversación",
    micStartTitle: "Hablar con InhubBot (Voz $0)",
    micStopTitle: "Detener escucha",
    micUnsupportedTitle: "Reconocimiento de voz no soportado en este navegador",
    cameraTitle: "Enviar foto de artículo o captura para modelar",
    sendTitle: "Enviar mensaje",
    connectionError: "Error de conexión con el asistente. Inténtalo de nuevo.",
    genericError: "Ocurrió un error al procesar el comando.",
    verifyTitle: "Verificación de identidad",
    degree1: "1er grado · Conectados",
    degree2: "2do grado",
    degree3: "3er grado",
    degreeUnknown: "Perfil LinkedIn",
    confirmYes: "Sí, es él",
    confirmNo: "No es él",
    confirmSeeOther: (c) => `No, ver otro (${c})`,
    confirmedStatus: "✅ Identidad confirmada. Preparando propuesta...",
    rejectedStatus: "❌ Perfil descartado.",
    verifySafetyNote: "No ejecutaré ninguna acción hasta que confirmes el perfil y apruebes el borrador.",
    typePost: "Publicación de LinkedIn",
    typeConnection: "Solicitud de Conexión",
    typeComment: "Comentario en Post",
    typeMessage: "Mensaje Directo / Propuesta",
    ctaPost: "Publicar ahora",
    ctaConnection: "Enviar conexión",
    ctaComment: "Publicar comentario",
    ctaMessage: "Enviar mensaje",
    forLabel: "Para:",
    originalPostLabel: "Post original:",
    saveDraftChanges: "✓ Guardar cambios en borrador",
    editBtn: "Editar",
    doneEditBtn: "Listo",
    scheduleBtn: "Agendar",
    confirmDateBtn: "Confirmar fecha",
    discardBtn: "Descartar",
    statusApproved: "✅ Aprobado y enviado a ejecución.",
    statusScheduled: "📅 Agendado en tu calendario editorial.",
    statusDiscarded: "🗑️ Borrador descartado.",
    keyMetrics: "Métricas Clave",
    realtimeBadge: "En tiempo real",
    crmLeads: "Prospectos CRM",
    highIntent: "Alta Intención",
    activeCampaigns: "Campañas Activas",
    scheduledPosts: "Posts Prog.",
    linearSequences: "Secuencias Lineales",
    codeLabel: "Código:",
    pauseBtn: "Pausar",
    activateBtn: "Activar",
    scheduledBadge: "Programado",
    draftBadge: "Borrador",
    qualifiedLeads: "Prospectos Calificados",
    linkedinStatus: "Estado de LinkedIn",
    activeAccountsLabel: "Cuentas activas:",
    activateVerb: "Activar",
    pauseVerb: "Pausar",
    campaignToggleLabel: (activate, name) => `${activate ? "Activar" : "Pausar"} campaña ${name}`,
    confirmPersonLabel: (name) => `Sí, es ${name}`,
    rejectPersonLabel: "No es esa persona",
    approveCmdLabel: "Aprobado, ejecutar ahora",
    scheduleCmdLabel: "Agendar publicación",
    discardCmdLabel: "Descartar borrador",
  },
  en: {
    greetingTitle: "Hello!",
    greetingSubtitle: "How can I help you today?",
    welcomeMessage:
      "Hi, I'm **InhubBot**. I can control your LinkedIn Social Selling platform by voice, text, or photo.\n\n• Snap a photo of a magazine article to model a post.\n• Ask me to find a prospect (I verify their profile photo and connection degree before acting).\n• I never publish or send anything without your approval.",
    resetMessage: "Conversation reset. What would you like me to run on your LinkedIn today?",
    heroChips: [
      "Give me today's summary",
      "How are campaigns going?",
      "Create viral post",
      "Latest radar prospects",
    ],
    quickActions: [
      "Give me today's summary",
      "How are campaigns going?",
      "Create a viral post about B2B sales",
      "Latest radar prospects",
      "LinkedIn account status",
    ],
    processingText: "InhubBot is processing...",
    listeningBanner: "Listening to your voice command in English...",
    stopListeningBtn: "Stop",
    inputListeningPlaceholder: "Listening...",
    inputImagePlaceholder: "e.g. Model this for our company and publish today...",
    inputDefaultPlaceholder: "Type, speak, or send a photo...",
    imageReadyHint: "Photo ready. Tell me what to model or send directly.",
    voiceEnableTitle: "Enable voice replies (TTS $0)",
    voiceDisableTitle: "Disable voice replies",
    resetChatTitle: "Reset conversation",
    micStartTitle: "Speak with InhubBot (Voice $0)",
    micStopTitle: "Stop listening",
    micUnsupportedTitle: "Voice recognition is not supported in this browser",
    cameraTitle: "Send a photo of an article or screenshot to model",
    sendTitle: "Send message",
    connectionError: "Connection error with the assistant. Please try again.",
    genericError: "An error occurred while processing the command.",
    verifyTitle: "Identity verification",
    degree1: "1st degree · Connected",
    degree2: "2nd degree",
    degree3: "3rd degree",
    degreeUnknown: "LinkedIn Profile",
    confirmYes: "Yes, that's them",
    confirmNo: "Not them",
    confirmSeeOther: (c) => `No, see next (${c})`,
    confirmedStatus: "✅ Identity confirmed. Preparing proposal...",
    rejectedStatus: "❌ Profile discarded.",
    verifySafetyNote: "I won't take any action until you confirm the profile and approve the draft.",
    typePost: "LinkedIn Post",
    typeConnection: "Connection Request",
    typeComment: "Post Comment",
    typeMessage: "Direct Message / Proposal",
    ctaPost: "Publish now",
    ctaConnection: "Send invite",
    ctaComment: "Post comment",
    ctaMessage: "Send message",
    forLabel: "To:",
    originalPostLabel: "Original post:",
    saveDraftChanges: "✓ Save draft changes",
    editBtn: "Edit",
    doneEditBtn: "Done",
    scheduleBtn: "Schedule",
    confirmDateBtn: "Confirm date",
    discardBtn: "Discard",
    statusApproved: "✅ Approved and sent for execution.",
    statusScheduled: "📅 Scheduled in your editorial calendar.",
    statusDiscarded: "🗑️ Draft discarded.",
    keyMetrics: "Key Metrics",
    realtimeBadge: "Live",
    crmLeads: "CRM Prospects",
    highIntent: "High Intent",
    activeCampaigns: "Active Campaigns",
    scheduledPosts: "Scheduled Posts",
    linearSequences: "Linear Sequences",
    codeLabel: "Code:",
    pauseBtn: "Pause",
    activateBtn: "Activate",
    scheduledBadge: "Scheduled",
    draftBadge: "Draft",
    qualifiedLeads: "Qualified Prospects",
    linkedinStatus: "LinkedIn Status",
    activeAccountsLabel: "Active accounts:",
    activateVerb: "Activate",
    pauseVerb: "Pause",
    campaignToggleLabel: (activate, name) => `${activate ? "Activate" : "Pause"} campaign ${name}`,
    confirmPersonLabel: (name) => `Yes, it's ${name}`,
    rejectPersonLabel: "Not that person",
    approveCmdLabel: "Approved, execute now",
    scheduleCmdLabel: "Schedule post",
    discardCmdLabel: "Discard draft",
  },
  "pt-BR": {
    greetingTitle: "Olá!",
    greetingSubtitle: "Como posso ajudar você hoje?",
    welcomeMessage:
      "Olá, sou o **InhubBot**. Posso controlar toda a sua plataforma de Social Selling no LinkedIn por voz, texto ou foto.\n\n• Tire foto de um artigo de revista para modelar um post.\n• Peça para buscar um prospect (eu verifico a foto de perfil e o grau de conexão antes de agir).\n• Nunca publico nem envio nada sem a sua aprovação.",
    resetMessage: "Conversa reiniciada. O que você deseja que eu execute no seu LinkedIn hoje?",
    heroChips: [
      "Me dê o resumo de hoje",
      "Como estão as campanhas?",
      "Criar post viral",
      "Últimos prospects do radar",
    ],
    quickActions: [
      "Me dê o resumo de hoje",
      "Como estão as campanhas?",
      "Criar post viral sobre vendas B2B",
      "Últimos prospects do radar",
      "Status da minha conta do LinkedIn",
    ],
    processingText: "InhubBot está processando...",
    listeningBanner: "Ouvindo seu comando de voz em português...",
    stopListeningBtn: "Parar",
    inputListeningPlaceholder: "Ouvindo...",
    inputImagePlaceholder: "Ex: Modele para nossa empresa e publique hoje...",
    inputDefaultPlaceholder: "Digite, fale ou envie uma foto...",
    imageReadyHint: "Foto pronta. Diga o que deseja modelar ou envie diretamente.",
    voiceEnableTitle: "Ativar resposta por voz (TTS $0)",
    voiceDisableTitle: "Desativar resposta por voz",
    resetChatTitle: "Reiniciar conversa",
    micStartTitle: "Falar com InhubBot (Voz $0)",
    micStopTitle: "Parar escuta",
    micUnsupportedTitle: "Reconhecimento de voz não suportado neste navegador",
    cameraTitle: "Enviar foto de artigo ou captura para modelar",
    sendTitle: "Enviar mensagem",
    connectionError: "Erro de conexão com o assistente. Tente novamente.",
    genericError: "Ocorreu um erro ao processar o comando.",
    verifyTitle: "Verificação de identidade",
    degree1: "1º grau · Conectados",
    degree2: "2º grau",
    degree3: "3º grau",
    degreeUnknown: "Perfil LinkedIn",
    confirmYes: "Sim, é ele(a)",
    confirmNo: "Não é ele(a)",
    confirmSeeOther: (c) => `Não, ver outro (${c})`,
    confirmedStatus: "✅ Identidade confirmada. Preparando proposta...",
    rejectedStatus: "❌ Perfil descartado.",
    verifySafetyNote: "Não executarei nenhuma ação até você confirmar o perfil e aprovar o rascunho.",
    typePost: "Publicação no LinkedIn",
    typeConnection: "Solicitação de Conexão",
    typeComment: "Comentário no Post",
    typeMessage: "Mensagem Direta / Proposta",
    ctaPost: "Publicar agora",
    ctaConnection: "Enviar conexão",
    ctaComment: "Publicar comentário",
    ctaMessage: "Enviar mensagem",
    forLabel: "Para:",
    originalPostLabel: "Post original:",
    saveDraftChanges: "✓ Salvar alterações no rascunho",
    editBtn: "Editar",
    doneEditBtn: "Pronto",
    scheduleBtn: "Agendar",
    confirmDateBtn: "Confirmar data",
    discardBtn: "Descartar",
    statusApproved: "✅ Aprovado e enviado para execução.",
    statusScheduled: "📅 Agendado no seu calendário editorial.",
    statusDiscarded: "🗑️ Rascunho descartado.",
    keyMetrics: "Métricas-Chave",
    realtimeBadge: "Tempo real",
    crmLeads: "Prospects CRM",
    highIntent: "Alta Intenção",
    activeCampaigns: "Campanhas Ativas",
    scheduledPosts: "Posts Agendados",
    linearSequences: "Sequências Lineares",
    codeLabel: "Código:",
    pauseBtn: "Pausar",
    activateBtn: "Ativar",
    scheduledBadge: "Agendado",
    draftBadge: "Rascunho",
    qualifiedLeads: "Prospects Qualificados",
    linkedinStatus: "Status do LinkedIn",
    activeAccountsLabel: "Contas ativas:",
    activateVerb: "Ativar",
    pauseVerb: "Pausar",
    campaignToggleLabel: (activate, name) => `${activate ? "Ativar" : "Pausar"} campanha ${name}`,
    confirmPersonLabel: (name) => `Sim, é ${name}`,
    rejectPersonLabel: "Não é essa pessoa",
    approveCmdLabel: "Aprovado, executar agora",
    scheduleCmdLabel: "Agendar publicação",
    discardCmdLabel: "Descartar rascunho",
  },
};
