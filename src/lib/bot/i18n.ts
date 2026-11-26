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
  heroChips: [string, string, string, string, string, string];
  quickActions: string[];
  processingText: string;
  listeningBanner: string;
  stopListeningBtn: string;
  holdToTalkLabel: string;
  releaseToSendLabel: string;
  holdHintShort: string;
  inputListeningPlaceholder: string;
  inputImagePlaceholder: string;
  inputDefaultPlaceholder: string;
  imageReadyHint: string;
  attachmentReadyHint: (fileName: string) => string;
  fileTooLargeError: string;
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
  sessionsMenuBtn: string;
  sessionsPanelTitle: string;
  newConversationBtn: string;
  noSessionsText: string;
  messagesCountLabel: (count: number) => string;
  deleteSessionTitle: string;
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
  publishedBadge: string;
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
  // Signals, Inbox, Pipeline, Campaign Draft cards
  signalsTitle: string;
  noSignalsText: string;
  createSignalBtn: string;
  signalToggleLabel: (activate: boolean, title: string) => string;
  createSignalCmdLabel: string;
  inboxTitle: string;
  unreadLabel: string;
  pendingSdrLabel: string;
  noInboxText: string;
  pipelineTitle: string;
  totalLeadsLabel: string;
  topLeadsLabel: string;
  noPipelineText: string;
  campaignDraftTitle: string;
  campaignNameLabel: string;
  campaignIcebreakerLabel: string;
  createCampaignCta: string;
  campaignCreatedStatus: string;
  createCampaignCmdLabel: string;
  liveModeBtn: string;
  liveModeOnTitle: string;
  liveModeOffTitle: string;
  liveModeListeningLabel: string;
  liveModeSpeakingLabel: string;
}

export const BOT_UI_LABELS: Record<BotLocale, BotUiLabels> = {
  es: {
    greetingTitle: "¡Hola!",
    greetingSubtitle: "¿En qué puedo ayudarte hoy?",
    welcomeMessage:
      "Hola, soy **InhubBot**. Puedo controlar tu plataforma de Social Selling en LinkedIn por voz, texto o foto.\n\n• Sácale foto a un artículo de revista para modelar un post.\n• Pídeme buscar a un prospecto (verifico su foto y grado de conexión antes de actuar).\n• Nunca publico ni envío nada sin tu aprobación.",
    resetMessage: "Conversación reiniciada. ¿Qué trabajo deseas que ejecute en tu LinkedIn hoy?",
    heroChips: [
      "Crear post viral",
      "Activar señales de intención",
      "Crear campaña de prospección",
      "Revisar el Inbox",
      "Revisar el Pipeline CRM",
      "Resumen de hoy",
    ],
    quickActions: [
      "Crear post viral",
      "Activar señales de intención",
      "Crear campaña de prospección",
      "Revisar el Inbox",
      "Revisar el Pipeline CRM",
      "Resumen de hoy",
    ],
    processingText: "InhubBot está procesando...",
    listeningBanner: "Escuchando tu comando de voz en español...",
    stopListeningBtn: "Detener",
    holdToTalkLabel: "Mantén presionado para hablar",
    releaseToSendLabel: "Escuchando... suelta para enviar",
    holdHintShort: "Mantén presionado mientras hablas y suelta para enviar",
    inputListeningPlaceholder: "Escuchando...",
    inputImagePlaceholder: "Ej: Modela este artículo enfocado a nuestra propuesta de valor...",
    inputDefaultPlaceholder: "Escribe o adjunta un archivo...",
    imageReadyHint: "Foto lista. Indica qué quieres modelar o envía directamente.",
    attachmentReadyHint: (name) => `Archivo "${name}" listo para modelar o analizar.`,
    fileTooLargeError: "El archivo supera el límite de 10 MB. Intenta con uno más liviano.",
    voiceEnableTitle: "Activar respuesta por voz (TTS $0)",
    voiceDisableTitle: "Desactivar respuesta por voz",
    resetChatTitle: "Reiniciar conversación",
    micStartTitle: "Hablar con InhubBot (Voz $0)",
    micStopTitle: "Detener escucha",
    micUnsupportedTitle: "Reconocimiento de voz no soportado en este navegador",
    cameraTitle: "Adjuntar foto, PDF o documento para modelar",
    sendTitle: "Enviar mensaje",
    connectionError: "Error de conexión con el asistente. Inténtalo de nuevo.",
    genericError: "Ocurrió un error al procesar el comando.",
    sessionsMenuBtn: "Sesiones",
    sessionsPanelTitle: "Últimas conversaciones",
    newConversationBtn: "Nueva conversación",
    noSessionsText: "Aún no tienes sesiones guardadas. Inicia una hablando o escribiendo.",
    messagesCountLabel: (count) => `${count} mensajes`,
    deleteSessionTitle: "Eliminar conversación",
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
    publishedBadge: "Publicado",
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
    signalsTitle: "Signal Radar · Señales de Intención",
    noSignalsText: "Aún no tienes monitores creados. Activa uno para capturar compradores con intención.",
    createSignalBtn: "Activar monitor de señales",
    signalToggleLabel: (activate, title) => `${activate ? "Activar" : "Pausar"} señal ${title}`,
    createSignalCmdLabel: "Activar nuevo monitor de señales",
    inboxTitle: "Smart Inbox Unificado",
    unreadLabel: "Sin leer",
    pendingSdrLabel: "Borradores SDR",
    noInboxText: "No hay conversaciones recientes en tu bandeja.",
    pipelineTitle: "Pipeline CRM",
    totalLeadsLabel: "Total leads",
    topLeadsLabel: "Mayor intención",
    noPipelineText: "No hay leads registrados en tu Pipeline todavía.",
    campaignDraftTitle: "Nueva Campaña de Prospección",
    campaignNameLabel: "Nombre de campaña",
    campaignIcebreakerLabel: "Mensaje inicial (Icebreaker)",
    createCampaignCta: "Crear y activar campaña",
    campaignCreatedStatus: "✅ Campaña creada y activada en tu dashboard.",
    createCampaignCmdLabel: "Crear y activar campaña",
    liveModeBtn: "En vivo",
    liveModeOnTitle: "Desactivar conversación en vivo",
    liveModeOffTitle: "Activar conversación en vivo (manos libres)",
    liveModeListeningLabel: "Modo en vivo · Habla libremente...",
    liveModeSpeakingLabel: "InhubBot hablando...",
  },
  en: {
    greetingTitle: "Hello!",
    greetingSubtitle: "How can I help you today?",
    welcomeMessage:
      "Hi, I'm **InhubBot**. I can control your LinkedIn Social Selling platform by voice, text, or photo.\n\n• Snap a photo of a magazine article to model a post.\n• Ask me to find a prospect (I verify their profile photo and connection degree before acting).\n• I never publish or send anything without your approval.",
    resetMessage: "Conversation reset. What would you like me to run on your LinkedIn today?",
    heroChips: [
      "Create viral post",
      "Activate intent signals",
      "Create outreach campaign",
      "Review Inbox",
      "Review CRM Pipeline",
      "Today's summary",
    ],
    quickActions: [
      "Create viral post",
      "Activate intent signals",
      "Create outreach campaign",
      "Review Inbox",
      "Review CRM Pipeline",
      "Today's summary",
    ],
    processingText: "InhubBot is processing...",
    listeningBanner: "Listening to your voice command in English...",
    stopListeningBtn: "Stop",
    holdToTalkLabel: "Hold to talk",
    releaseToSendLabel: "Listening... release to send",
    holdHintShort: "Press and hold while speaking, then release to send",
    inputListeningPlaceholder: "Listening...",
    inputImagePlaceholder: "e.g. Model this article around our value proposition...",
    inputDefaultPlaceholder: "Type or attach a file...",
    imageReadyHint: "Photo ready. Tell me what to model or send directly.",
    attachmentReadyHint: (name) => `File "${name}" ready to model or analyze.`,
    fileTooLargeError: "File exceeds the 10 MB limit. Please choose a smaller file.",
    voiceEnableTitle: "Enable voice replies (TTS $0)",
    voiceDisableTitle: "Disable voice replies",
    resetChatTitle: "Reset conversation",
    micStartTitle: "Speak with InhubBot (Voice $0)",
    micStopTitle: "Stop listening",
    micUnsupportedTitle: "Voice recognition is not supported in this browser",
    cameraTitle: "Attach photo, PDF, or document to model",
    sendTitle: "Send message",
    connectionError: "Connection error with the assistant. Please try again.",
    genericError: "An error occurred while processing the command.",
    sessionsMenuBtn: "Sessions",
    sessionsPanelTitle: "Recent conversations",
    newConversationBtn: "New conversation",
    noSessionsText: "No saved sessions yet. Start one by speaking or typing.",
    messagesCountLabel: (count) => `${count} messages`,
    deleteSessionTitle: "Delete conversation",
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
    publishedBadge: "Published",
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
    signalsTitle: "Signal Radar · Intent Signals",
    noSignalsText: "No monitors created yet. Activate one to capture high-intent buyers.",
    createSignalBtn: "Activate signal monitor",
    signalToggleLabel: (activate, title) => `${activate ? "Activate" : "Pause"} signal ${title}`,
    createSignalCmdLabel: "Activate new signal monitor",
    inboxTitle: "Unified Smart Inbox",
    unreadLabel: "Unread",
    pendingSdrLabel: "SDR drafts",
    noInboxText: "No recent conversations in your inbox.",
    pipelineTitle: "CRM Pipeline",
    totalLeadsLabel: "Total leads",
    topLeadsLabel: "Highest intent",
    noPipelineText: "No leads recorded in your Pipeline yet.",
    campaignDraftTitle: "New Outreach Campaign",
    campaignNameLabel: "Campaign name",
    campaignIcebreakerLabel: "Icebreaker message",
    createCampaignCta: "Create & activate campaign",
    campaignCreatedStatus: "✅ Campaign created and activated in your dashboard.",
    createCampaignCmdLabel: "Create and activate campaign",
    liveModeBtn: "Live",
    liveModeOnTitle: "Disable live conversation",
    liveModeOffTitle: "Enable live conversation (hands-free)",
    liveModeListeningLabel: "Live mode · Speak naturally...",
    liveModeSpeakingLabel: "InhubBot speaking...",
  },
  "pt-BR": {
    greetingTitle: "Olá!",
    greetingSubtitle: "Como posso ajudar você hoje?",
    welcomeMessage:
      "Olá, sou o **InhubBot**. Posso controlar toda a sua plataforma de Social Selling no LinkedIn por voz, texto ou foto.\n\n• Tire foto de um artigo de revista para modelar um post.\n• Peça para buscar um prospect (eu verifico a foto de perfil e o grau de conexão antes de agir).\n• Nunca publico nem envio nada sem a sua aprovação.",
    resetMessage: "Conversa reiniciada. O que você deseja que eu execute no seu LinkedIn hoje?",
    heroChips: [
      "Criar post viral",
      "Ativar sinais de intenção",
      "Criar campanha de prospecção",
      "Revisar o Inbox",
      "Revisar o Pipeline CRM",
      "Resumo de hoje",
    ],
    quickActions: [
      "Criar post viral",
      "Ativar sinais de intenção",
      "Criar campanha de prospecção",
      "Revisar o Inbox",
      "Revisar o Pipeline CRM",
      "Resumo de hoje",
    ],
    processingText: "InhubBot está processando...",
    listeningBanner: "Ouvindo seu comando de voz em português...",
    stopListeningBtn: "Parar",
    holdToTalkLabel: "Segure para falar",
    releaseToSendLabel: "Ouvindo... solte para enviar",
    holdHintShort: "Segure enquanto fala e solte para enviar",
    inputListeningPlaceholder: "Ouvindo...",
    inputImagePlaceholder: "Ex: Modele este artigo focado na nossa proposta de valor...",
    inputDefaultPlaceholder: "Digite ou anexe um arquivo...",
    imageReadyHint: "Foto pronta. Diga o que deseja modelar ou envie diretamente.",
    attachmentReadyHint: (name) => `Arquivo "${name}" pronto para modelar ou analisar.`,
    fileTooLargeError: "O arquivo ultrapassa o limite de 10 MB. Tente um arquivo menor.",
    voiceEnableTitle: "Ativar resposta por voz (TTS $0)",
    voiceDisableTitle: "Desativar resposta por voz",
    resetChatTitle: "Reiniciar conversa",
    micStartTitle: "Falar com InhubBot (Voz $0)",
    micStopTitle: "Parar escuta",
    micUnsupportedTitle: "Reconhecimento de voz não suportado neste navegador",
    cameraTitle: "Anexar foto, PDF ou documento para modelar",
    sendTitle: "Enviar mensagem",
    connectionError: "Erro de conexão com o assistente. Tente novamente.",
    genericError: "Ocorreu um erro ao processar o comando.",
    sessionsMenuBtn: "Sessões",
    sessionsPanelTitle: "Últimas conversas",
    newConversationBtn: "Nova conversa",
    noSessionsText: "Você ainda não tem sessões salvas. Inicie uma falando ou digitando.",
    messagesCountLabel: (count) => `${count} mensagens`,
    deleteSessionTitle: "Excluir conversa",
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
    publishedBadge: "Publicado",
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
    signalsTitle: "Signal Radar · Sinais de Intenção",
    noSignalsText: "Você ainda não tem monitores criados. Ative um para capturar compradores.",
    createSignalBtn: "Ativar monitor de sinais",
    signalToggleLabel: (activate, title) => `${activate ? "Ativar" : "Pausar"} sinal ${title}`,
    createSignalCmdLabel: "Ativar novo monitor de sinais",
    inboxTitle: "Smart Inbox Unificado",
    unreadLabel: "Não lidas",
    pendingSdrLabel: "Rascunhos SDR",
    noInboxText: "Não há conversas recentes na sua caixa de entrada.",
    pipelineTitle: "Pipeline CRM",
    totalLeadsLabel: "Total leads",
    topLeadsLabel: "Maior intenção",
    noPipelineText: "Ainda não há leads registrados no seu Pipeline.",
    campaignDraftTitle: "Nova Campanha de Prospecção",
    campaignNameLabel: "Nome da campanha",
    campaignIcebreakerLabel: "Mensagem inicial (Icebreaker)",
    createCampaignCta: "Criar e ativar campanha",
    campaignCreatedStatus: "✅ Campanha criada e ativada no seu dashboard.",
    createCampaignCmdLabel: "Criar e ativar campanha",
    liveModeBtn: "Ao vivo",
    liveModeOnTitle: "Desativar conversa ao vivo",
    liveModeOffTitle: "Ativar conversa ao vivo (mãos livres)",
    liveModeListeningLabel: "Modo ao vivo · Fale livremente...",
    liveModeSpeakingLabel: "InhubBot falando...",
  },
};
