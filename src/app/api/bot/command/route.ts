import {
  callGeminiMultimodal,
  executeApprovedAction,
  getApprovedKnowledgeContext,
  getLatestPostOfPerson,
  resolveActiveLinkedInAccount,
  searchLinkedInPeopleForVerification,
  type ApprovalActionPayload,
  type GeminiTurn,
  type VerifiedPersonCandidate,
} from "@/lib/bot/agent-helpers";
import {
  BOT_UI_LABELS,
  getBotLocale,
  getLocaleDisplayName,
  type BotLocale,
} from "@/lib/bot/i18n";
import { INHUBFLOW_MASTER_KNOWLEDGE } from "@/lib/bot/platform-knowledge";
import { getSocialSellingDb } from "@/lib/persistence/db";
import { unipile } from "@/lib/unipile/client";
import { getNicheViralPosts } from "@/lib/viral-posts/niche-search";
import { NextRequest, NextResponse } from "next/server";

export interface BotActionCard {
  type: "summary" | "campaigns" | "post" | "leads" | "accounts" | "profile_verify" | "approval";
  data: Record<string, unknown>;
}

interface BotCommandResponse {
  ok: boolean;
  reply: string;
  emotion: "idle" | "talking" | "thinking" | "happy" | "excited";
  cards?: BotActionCard[];
  quickActions?: string[];
  spokenText?: string;
}

interface HistoryItem {
  sender?: "user" | "bot";
  text?: string;
}

function t(locale: BotLocale, es: string, en: string, pt: string): string {
  if (locale === "en") return en;
  if (locale === "pt-BR") return pt;
  return es;
}

function getPlatformSummary() {
  const db = getSocialSellingDb();
  const count = (sql: string, params: unknown[] = []) => {
    try {
      const r = db.prepare(sql).get(...params) as { c: number } | undefined;
      return Number(r?.c || 0);
    } catch {
      return 0;
    }
  };

  const totalLeads = count("SELECT COUNT(*) as c FROM crm_leads_360");
  const qualifiedLeads = count("SELECT COUNT(*) as c FROM crm_leads_360 WHERE intent_score >= 80");
  const viralPostsDraft = count("SELECT COUNT(*) as c FROM viral_posts WHERE status = 'draft'");
  const viralPostsScheduled = count("SELECT COUNT(*) as c FROM viral_posts WHERE status = 'scheduled'");
  const viralPostsPublished = count("SELECT COUNT(*) as c FROM viral_posts WHERE status = 'published'");
  const activeMonitors = count("SELECT COUNT(*) as c FROM signal_monitors WHERE status = 'active'");
  const totalMonitors = count("SELECT COUNT(*) as c FROM signal_monitors");
  const activeCampaigns = count("SELECT COUNT(*) as c FROM linear_campaigns WHERE status = 'active'");
  const totalCampaigns = count("SELECT COUNT(*) as c FROM linear_campaigns");

  let accountsCount = 0;
  let activeAccounts = 0;
  try {
    const accs = db.prepare("SELECT status FROM linkedin_accounts_v2").all() as Array<{ status: string }>;
    accountsCount = accs.length;
    activeAccounts = accs.filter(
      (a) => a.status === "OK" || a.status === "CONNECTED" || a.status === "active"
    ).length;
  } catch {
    accountsCount = count("SELECT COUNT(*) as c FROM linkedin_accounts");
    activeAccounts = count(
      "SELECT COUNT(*) as c FROM linkedin_accounts WHERE status = 'OK' OR status = 'CONNECTED'"
    );
  }

  const today = new Date().toISOString().split("T")[0];
  let todayDms = 0;
  let todayInvites = 0;
  try {
    const pacing = db
      .prepare(
        "SELECT SUM(dms_sent) as d, SUM(invitations_sent) as i FROM campaign_daily_pacing_v2 WHERE action_date = ?"
      )
      .get(today) as { d?: number; i?: number } | undefined;
    todayDms = Number(pacing?.d || 0);
    todayInvites = Number(pacing?.i || 0);
  } catch {}

  return {
    accounts: { total: accountsCount, active: activeAccounts },
    leads: { total: totalLeads, qualified: qualifiedLeads },
    posts: { draft: viralPostsDraft, scheduled: viralPostsScheduled, published: viralPostsPublished },
    signals: { active: activeMonitors, total: totalMonitors },
    campaigns: { active: activeCampaigns, total: totalCampaigns },
    pacingToday: { dms: todayDms, invites: todayInvites },
  };
}

function getCampaignsList() {
  const db = getSocialSellingDb();
  try {
    const rows = db.prepare("SELECT * FROM linear_campaigns ORDER BY code ASC LIMIT 10").all() as Array<{
      id: string;
      name: string;
      code: string;
      status: string;
      metadata_json?: string;
    }>;
    return rows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch {}
      return {
        id: r.id,
        name: String(meta.name || r.name),
        code: String(meta.code || r.code),
        status: String(meta.status || r.status || "active"),
        leadsCount: Number(meta.leadsCount || 0),
      };
    });
  } catch {
    return [];
  }
}

function toggleCampaignStatus(campaignId: string, targetStatus: "active" | "paused") {
  const db = getSocialSellingDb();
  try {
    const row = db
      .prepare("SELECT metadata_json FROM linear_campaigns WHERE id = ?")
      .get(campaignId) as { metadata_json?: string } | undefined;
    let meta: Record<string, unknown> = {};
    if (row?.metadata_json) {
      try {
        meta = JSON.parse(row.metadata_json);
      } catch {}
    }
    meta.status = targetStatus;
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE linear_campaigns SET status = ?, updated_at = ?, metadata_json = ? WHERE id = ?"
    ).run(targetStatus, now, JSON.stringify(meta), campaignId);
    return true;
  } catch {
    return false;
  }
}

function getRecentLeads() {
  const db = getSocialSellingDb();
  try {
    const rows = db.prepare("SELECT * FROM crm_leads_360 ORDER BY created_at DESC LIMIT 6").all() as Array<{
      id: string;
      full_name: string;
      stage: string;
      intent_score: number;
      linkedin_url?: string;
      metadata_json?: string;
    }>;
    return rows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch {}
      return {
        id: r.id,
        name: r.full_name,
        headline: String(meta.headline || meta.title || "B2B Decision Maker"),
        stage: r.stage,
        score: r.intent_score,
        profileUrl: r.linkedin_url || "#",
      };
    });
  } catch {
    return [];
  }
}

function buildHistoryTurns(history?: HistoryItem[]): GeminiTurn[] {
  const turns: GeminiTurn[] = [];
  if (!Array.isArray(history)) return turns;
  for (const h of history.slice(-6)) {
    const text = String(h?.text || "").trim();
    if (!text) continue;
    const role = h.sender === "user" ? "user" : "model";
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text });
    } else {
      turns.push({ role, parts: [{ text }] });
    }
  }
  return turns;
}

function parseJsonSafe<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

interface ClassifiedIntent {
  intent: "person_outreach" | "create_viral_post" | "general_chat";
  personQuery?: string;
  intendedAction?: "message" | "connection" | "comment" | "proposal" | "auto";
  userContext?: string;
  topic?: string;
  searchViralFirst?: boolean;
  scheduledDateIso?: string;
}

async function classifyBotIntent(
  message: string,
  history: HistoryItem[],
  kbContext: string
): Promise<ClassifiedIntent> {
  const nowIso = new Date().toISOString();
  const recentHistory = history
    .slice(-4)
    .map((h) => `${h.sender === "user" ? "User" : "InhubBot"}: ${String(h.text || "").slice(0, 350)}`)
    .join("\n");

  const res = await callGeminiMultimodal({
    preferFast: true,
    systemPrompt: `You are the intent classifier for InhubBot (LinkedIn Social Selling in es/en/pt-BR).
Current UTC datetime: ${nowIso}.

Classify the user's latest message (considering recent conversation history) into ONE of 3 intents:
1. "person_outreach": The user explicitly asks to find, contact, message, send a proposal/video, send a connection request, or comment on a post of ONE SPECIFIC NAMED PERSON (e.g. "busca a Juan Pérez de TechCorp", "comenta el último post de Carlos Ruiz", "find Sarah from Acme"). Do NOT use this for general questions like "how do I connect with prospects?".
2. "create_viral_post": The user asks to create, draft, write, model, search viral posts for inspiration, OR refine/rewrite/shorten/change an existing post draft shown in recent history (e.g. "crea un post sobre IA", "hazlo más corto", "cambia el gancho", "busca los mejores posts de ventas").
3. "general_chat": Any strategic question, platform how-to question ("¿Cómo funciona Signal Radar?", "¿Cómo mejoro mi perfil de LinkedIn?", "¿Qué métricas importan para marca personal?"), brainstorming, mentoring, or general conversation.

Recent history:
${recentHistory || "(none)"}

Company context snippet: ${kbContext.slice(0, 400)}

Return ONLY valid JSON:
{
  "intent": "person_outreach" | "create_viral_post" | "general_chat",
  "personQuery": "Name Company (if applicable)",
  "intendedAction": "message" | "connection" | "comment" | "proposal" | "auto",
  "userContext": "instructions/event/resource requested by user",
  "topic": "post topic or refinement instruction (if applicable)",
  "searchViralFirst": true o false,
  "scheduledDateIso": "ISO string if user specified date/time, or null"
}`,
    turns: [{ role: "user", parts: [{ text: message }] }],
    temperature: 0.1,
    maxOutputTokens: 500,
    jsonMode: true,
  });

  if (res.ok && res.text) {
    const parsed = parseJsonSafe<ClassifiedIntent>(res.text);
    if (parsed?.intent) return parsed;
  }

  const lower = message.toLowerCase();
  if (
    /\b(busca a|contacta a|conecta con|solicitud de conexi[oó]n a|m[aá]ndale.*a |env[ií]ale.*a |comenta.*publicaci[oó]n de|comenta.*post de|escr[ií]bele a|find |search for |reach out to |connect with |send a message to |comment on .*post|procure |busque |mande .*para |envie .*para |comente .*post de|linkedin\.com\/in\/)\b/i.test(
      lower
    )
  ) {
    const isComment = /comenta|comment|comente/i.test(lower);
    const isConnect = /conexi[oó]n|conecta|connect|conex[aã]o/i.test(lower);
    const isProp = /propuesta|proposal|proposta|video|recurso/i.test(lower);
    const cleanPerson = message
      .replace(
        /\b(por favor|please|inhub|inhubbot|quiero que|busca a|contacta a|conecta con|m[aá]ndale|env[ií]ale|find|search for|connect with|reach out to|procure|busque|mande|envie|una propuesta|un mensaje|solicitud de conexi[oó]n)\b/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    return {
      intent: "person_outreach",
      personQuery: cleanPerson || message.slice(0, 60),
      intendedAction: isComment ? "comment" : isConnect ? "connection" : isProp ? "proposal" : "auto",
      userContext: message,
    };
  }

  if (
    /\b(crear post|crea un post|nuevo post|escribe un post|modela|publicar|mejores posts|posts virales|create.*post|viral post|write a post|criar post|novo post|post viral|carrusel|carousel)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "create_viral_post",
      topic: message,
      searchViralFirst: /mejores|virales|busca|best|top|viral|search|melhores|procure/i.test(lower),
    };
  }

  return { intent: "general_chat" };
}

async function generatePostApprovalData(params: {
  topicOrInstruction: string;
  kbContext: string;
  companyName: string | null;
  locale: BotLocale;
  referencePostsText?: string;
  imageBase64?: string;
  imageMimeType?: string;
  attachmentName?: string;
}): Promise<{ title: string; content: string; summaryNote: string }> {
  const langName = getLocaleDisplayName(params.locale);
  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
  let extractedTextDoc = "";

  if (params.imageBase64 && params.imageMimeType) {
    const mime = params.imageMimeType.toLowerCase();
    if (mime.startsWith("image/") || mime === "application/pdf") {
      parts.push({
        inline_data: {
          mime_type: params.imageMimeType,
          data: params.imageBase64,
        },
      });
    } else if (mime.startsWith("text/") || /\.(txt|md|csv)$/i.test(params.attachmentName || "")) {
      try {
        extractedTextDoc = Buffer.from(params.imageBase64, "base64").toString("utf8").slice(0, 12000);
      } catch {}
    }
  }

  const isPdf = (params.imageMimeType || "").toLowerCase() === "application/pdf";
  const attachmentIntro = params.imageBase64
    ? isPdf
      ? `The user attached a PDF document ("${params.attachmentName || "documento.pdf"}"). Read and extract all key arguments, data, and insights from this PDF.`
      : extractedTextDoc
        ? `The user attached a text document ("${params.attachmentName || "archivo.txt"}"):\n"""\n${extractedTextDoc}\n"""`
        : "The user attached an IMAGE (e.g., magazine article photo, screenshot, or chart). Extract all key text, insights, and framing from it."
    : "";

  const promptText = [
    attachmentIntro,
    `User instruction: "${params.topicOrInstruction || "Model this content into an authority LinkedIn post aligned with our company's solutions and value proposition."}"`,
    params.referencePostsText
      ? `\nTop viral LinkedIn posts to model structure & hook from:\n${params.referencePostsText}`
      : "",
    `\nCompany Knowledge Base (${params.companyName || "InhubFlow"}):\n${params.kbContext.slice(0, 3000)}`,
    `\nIMPORTANT: Write ALL fields ("title", "summaryNote", "content") strictly in ${langName}.
Return ONLY valid JSON:
{
  "title": "Short descriptive title (max 55 chars)",
  "summaryNote": "1 concise sentence explaining what you modeled",
  "content": "Full LinkedIn post ready for human approval with strong 2-line hook, scannable spacing, value aligned to the company, and clear CTA"
}`,
  ]
    .filter(Boolean)
    .join("\n");

  parts.push({ text: promptText });

  const ai = await callGeminiMultimodal({
    systemPrompt: `You are an expert B2B LinkedIn Social Selling copywriter. Draft high-authority posts for human approval before publishing. Always write in ${langName}.`,
    turns: [{ role: "user", parts }],
    temperature: 0.7,
    maxOutputTokens: 1500,
    jsonMode: true,
  });

  if (ai.ok && ai.text) {
    const parsed = parseJsonSafe<{ title?: string; content?: string; summaryNote?: string }>(ai.text);
    if (parsed?.content) {
      return {
        title: parsed.title || t(params.locale, "Post modelado para LinkedIn", "Modeled LinkedIn Post", "Post modelado para LinkedIn"),
        content: parsed.content,
        summaryNote:
          parsed.summaryNote ||
          t(
            params.locale,
            "Borrador optimizado con tu Base de Conocimiento.",
            "Draft optimized with your Knowledge Base.",
            "Rascunho otimizado com sua Base de Conhecimento."
          ),
      };
    }
    const cleanText = ai.text.replace(/```json|```/gi, "").trim();
    if (cleanText.length > 40) {
      return {
        title: cleanText.split("\n")[0]?.slice(0, 55) || t(params.locale, "Post modelado para LinkedIn", "Modeled LinkedIn Post", "Post modelado para LinkedIn"),
        content: cleanText,
        summaryNote: t(
          params.locale,
          "Borrador generado con IA y tu Base de Conocimiento.",
          "AI-generated draft grounded in your Knowledge Base.",
          "Rascunho gerado com IA e sua Base de Conhecimento."
        ),
      };
    }
  }

  const cleanTopic = params.topicOrInstruction.slice(0, 70) || "Social Selling B2B";
  return {
    title: t(params.locale, `Insights sobre ${cleanTopic}`, `Insights on ${cleanTopic}`, `Insights sobre ${cleanTopic}`),
    summaryNote: t(
      params.locale,
      "Borrador preparado listo para tu revisión.",
      "Draft prepared and ready for your review.",
      "Rascunho preparado e pronto para sua revisão."
    ),
    content: t(
      params.locale,
      `La mayoría en ${cleanTopic} sigue enfocándose en volumen frío en lugar de relevancia real.\n\nCuando combinas señales de intención con contenido de autoridad, cada conversación empieza con contexto y confianza.\n\n3 claves:\n1. Diagnóstico claro del problema.\n2. Contenido práctico.\n3. Seguimiento humano.\n\n¿Cómo lo abordan en tu equipo?`,
      `Most teams in ${cleanTopic} still focus on cold volume instead of real relevance.\n\nWhen you combine intent signals with authority content, every conversation starts with context and trust.\n\n3 keys:\n1. Clear diagnosis of the problem.\n2. Practical content.\n3. Human follow-up.\n\nHow is your team approaching this?`,
      `A maioria em ${cleanTopic} ainda foca em volume frio em vez de relevância real.\n\nQuando você combina sinais de intenção com conteúdo de autoridade, cada conversa começa com contexto e confiança.\n\n3 pilares:\n1. Diagnóstico claro do problema.\n2. Conteúdo prático.\n3. Follow-up humanizado.\n\nComo sua equipe está fazendo isso hoje?`
    ),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const locale = getBotLocale(typeof body.locale === "string" ? body.locale : undefined);
    const ui = BOT_UI_LABELS[locale];
    const langName = getLocaleDisplayName(locale);
    const message = String(body.message || "").trim();
    const action = String(body.action || "").trim();
    const payload = (body.payload || {}) as Record<string, unknown>;
    const fileBase64 =
      typeof body.fileBase64 === "string"
        ? body.fileBase64
        : typeof body.imageBase64 === "string"
          ? body.imageBase64
          : undefined;
    const fileMimeType =
      typeof body.fileMimeType === "string"
        ? body.fileMimeType
        : typeof body.imageMimeType === "string"
          ? body.imageMimeType
          : undefined;
    const fileName = typeof body.fileName === "string" ? body.fileName : undefined;
    const imageBase64 = fileBase64;
    const imageMimeType = fileMimeType;
    const history = Array.isArray(body.history) ? (body.history as HistoryItem[]) : [];
    const lower = message.toLowerCase();

    // =========================================================================
    // 1. ACCIONES EXPLÍCITAS DESDE TARJETAS (HUMAN-IN-THE-LOOP)
    // =========================================================================

    if (action === "toggle_campaign" && payload?.campaignId && payload?.status) {
      const ok = toggleCampaignStatus(
        String(payload.campaignId),
        payload.status === "active" ? "active" : "paused"
      );
      const campaigns = getCampaignsList();
      const isActivating = payload.status === "active";
      const campName = String(payload.campaignName || payload.campaignId);
      const statusText = isActivating
        ? t(locale, "activada", "activated", "ativada")
        : t(locale, "pausada", "paused", "pausada");

      return NextResponse.json({
        ok,
        reply: t(
          locale,
          `Listo. La campaña **${campName}** ha sido **${statusText}** con éxito.`,
          `Done. Campaign **${campName}** has been **${statusText}** successfully.`,
          `Pronto. A campanha **${campName}** foi **${statusText}** com sucesso.`
        ),
        spokenText: t(
          locale,
          `Campaña ${statusText} correctamente.`,
          `Campaign ${statusText} successfully.`,
          `Campanha ${statusText} com sucesso.`
        ),
        emotion: "talking",
        cards: [{ type: "campaigns", data: { campaigns } }],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (action === "confirm_profile" && payload?.person) {
      const person = payload.person as VerifiedPersonCandidate;
      const intendedAction = String(payload.intendedAction || "auto");
      const userContext = String(payload.userContext || "");
      const kb = getApprovedKnowledgeContext();
      const { accountId } = await resolveActiveLinkedInAccount();

      const isFirstDegree = person.networkDistance === "FIRST_DEGREE";
      const distLabel =
        person.networkDistance === "FIRST_DEGREE"
          ? t(locale, "1er nivel (ya conectados)", "1st degree (already connected)", "1º grau (já conectados)")
          : person.networkDistance === "SECOND_DEGREE"
            ? t(locale, "2do nivel", "2nd degree", "2º grau")
            : person.networkDistance === "THIRD_DEGREE"
              ? t(locale, "3er nivel", "3rd degree", "3º grau")
              : t(locale, "fuera de tu red directa", "outside your direct network", "fora da sua rede direta");

      if (intendedAction === "comment") {
        const identifier = person.publicIdentifier || person.providerId;
        const latestPost = accountId ? await getLatestPostOfPerson(identifier, accountId) : null;

        if (!latestPost) {
          return NextResponse.json({
            ok: true,
            reply: t(
              locale,
              `Confirmado: **${person.name}**. No encontré publicaciones públicas recientes en su perfil para comentar.\n\n¿Quieres que le enviemos ${
                isFirstDegree ? "un mensaje directo" : "una solicitud de conexión"
              } en su lugar?`,
              `Confirmed: **${person.name}**. I couldn't find recent public posts on their profile to comment on.\n\nWould you like to send ${
                isFirstDegree ? "a direct message" : "a connection request"
              } instead?`,
              `Confirmado: **${person.name}**. Não encontrei publicações públicas recentes no perfil para comentar.\n\nQuer que eu envie ${
                isFirstDegree ? "uma mensagem direta" : "uma solicitação de conexão"
              } no lugar?`
            ),
            spokenText: t(
              locale,
              `No encontré publicaciones recientes de ${person.name}.`,
              `I couldn't find recent posts from ${person.name}.`,
              `Não encontrei publicações recentes de ${person.name}.`
            ),
            emotion: "thinking",
            quickActions: ui.quickActions,
          } as BotCommandResponse);
        }

        const postText = String(latestPost.text || latestPost.content || "").slice(0, 900);
        const aiComment = await callGeminiMultimodal({
          systemPrompt: `Write a short, genuine, high-value LinkedIn comment (max 2-3 sentences) on a prospect's post. Not spammy. Respond ONLY with the comment text in ${langName}.`,
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `Prospect: ${person.name} (${person.headline})\nTheir post:\n"${postText}"\nExtra instruction: ${userContext || "None"}\nCompany context: ${kb.contextText.slice(0, 800)}`,
                },
              ],
            },
          ],
          temperature: 0.7,
          maxOutputTokens: 500,
        });

        const firstName = person.name.split(" ")[0];
        const draftComment =
          aiComment.ok && aiComment.text
            ? aiComment.text
            : t(
                locale,
                `Muy buen punto, ${firstName}. Coincido totalmente con esa visión; cuando se ejecuta con foco marca una diferencia real.`,
                `Great point, ${firstName}. I completely agree with this perspective—when executed with focus, it makes a real difference.`,
                `Excelente ponto, ${firstName}. Concordo totalmente com essa visão; quando executada com foco, faz muita diferença.`
              );

        const approval: ApprovalActionPayload = {
          type: "comment",
          preview: draftComment,
          targetName: person.name,
          targetHeadline: person.headline,
          targetProviderId: person.providerId,
          targetPostId: latestPost.social_id || latestPost.id,
          targetPostSnippet: postText.slice(0, 180),
          networkDistance: person.networkDistance,
        };

        return NextResponse.json({
          ok: true,
          reply: t(
            locale,
            `Perfecto, encontré la última publicación de **${person.name}**.\n\nAquí tienes mi propuesta de comentario. Revísala y apruébala antes de publicarla:`,
            `Got it — I found **${person.name}**'s latest post.\n\nHere is my proposed comment. Review and approve before I publish it:`,
            `Perfeito, encontrei a última publicação de **${person.name}**.\n\nAqui está a minha sugestão de comentário. Revise e aprove antes de publicar:`
          ),
          spokenText: t(
            locale,
            `Preparé un comentario para la última publicación de ${person.name}.`,
            `I drafted a comment for ${person.name}'s latest post.`,
            `Preparei um comentário para o último post de ${person.name}.`
          ),
          emotion: "talking",
          cards: [{ type: "approval", data: { approval } }],
        } as BotCommandResponse);
      }

      if (isFirstDegree) {
        const aiMsg = await callGeminiMultimodal({
          systemPrompt: `You are Inhub, SDR assistant for ${kb.companyName || "InhubFlow"}. Draft a personalized LinkedIn direct message for a 1st-degree connection. Integrate event context, proposal or Knowledge Base resources if requested. Respond ONLY with the message text in ${langName}.`,
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `Recipient: ${person.name} (${person.headline})\nUser instruction: ${userContext || "Greet and share our proposal"}\nKnowledge Base:\n${kb.contextText}`,
                },
              ],
            },
          ],
          temperature: 0.7,
          maxOutputTokens: 800,
        });

        const firstName = person.name.split(" ")[0];
        const draftMsg =
          aiMsg.ok && aiMsg.text
            ? aiMsg.text
            : t(
                locale,
                `Hola ${firstName}, un gusto saludarte. Me encantaría compartirte cómo ayudamos a equipos como el tuyo a generar reuniones calificadas en LinkedIn. ¿Conversamos 15 minutos esta semana?`,
                `Hi ${firstName}, great connecting with you. I'd love to share how we help teams like yours book qualified LinkedIn meetings. Open to a quick 15-minute chat this week?`,
                `Olá ${firstName}, tudo bem? Gostaria de compartilhar como ajudamos equipes como a sua a gerar reuniões qualificadas no LinkedIn. Topa uma conversa de 15 minutos esta semana?`
              );

        const approval: ApprovalActionPayload = {
          type: "message",
          preview: draftMsg,
          targetName: person.name,
          targetHeadline: person.headline,
          targetProviderId: person.providerId,
          targetPublicIdentifier: person.publicIdentifier,
          targetProfileUrl: person.profileUrl,
          networkDistance: person.networkDistance,
        };

        return NextResponse.json({
          ok: true,
          reply: t(
            locale,
            `Confirmado: **${person.name}** está en tu **${distLabel}** ✅.\n\nComo ya están conectados, preparé este **mensaje directo**. Aprueba o edita antes de enviarlo:`,
            `Confirmed: **${person.name}** is a **${distLabel}** ✅.\n\nSince you're already connected, I drafted this **direct message**. Approve or edit before sending:`,
            `Confirmado: **${person.name}** está no seu **${distLabel}** ✅.\n\nComo vocês já estão conectados, preparei esta **mensagem direta**. Aprove ou edite antes de enviar:`
          ),
          spokenText: t(
            locale,
            `${person.name} ya es contacto de primer grado. Preparé el mensaje directo para tu aprobación.`,
            `${person.name} is a first-degree connection. I prepared the direct message for your approval.`,
            `${person.name} já é conexão de primeiro grau. Preparei a mensagem para sua aprovação.`
          ),
          emotion: "excited",
          cards: [{ type: "approval", data: { approval } }],
        } as BotCommandResponse);
      } else {
        const aiInvite = await callGeminiMultimodal({
          systemPrompt: `Write a short LinkedIn connection request note (STRICTLY max 260 characters). Warm, human, mentioning context if provided. Respond ONLY with the note text in ${langName}.`,
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `Recipient: ${person.name} (${person.headline})\nUser context: ${userContext || "Connect professionally"}`,
                },
              ],
            },
          ],
          temperature: 0.7,
          maxOutputTokens: 400,
        });

        const firstName = person.name.split(" ")[0];
        const draftInvite = (
          aiInvite.ok && aiInvite.text
            ? aiInvite.text
            : t(
                locale,
                `Hola ${firstName}, qué gusto encontrarte por aquí. Me encantaría conectar contigo en LinkedIn y mantener el contacto.`,
                `Hi ${firstName}, great finding you here. I'd love to connect with you on LinkedIn and stay in touch.`,
                `Olá ${firstName}, muito bom encontrar você por aqui. Gostaria de me conectar no LinkedIn e manter contato.`
              )
        ).slice(0, 285);

        const approval: ApprovalActionPayload = {
          type: "connection",
          preview: draftInvite,
          targetName: person.name,
          targetHeadline: person.headline,
          targetProviderId: person.providerId,
          targetPublicIdentifier: person.publicIdentifier,
          targetProfileUrl: person.profileUrl,
          networkDistance: person.networkDistance,
        };

        const extraHint =
          intendedAction === "message" || intendedAction === "proposal"
            ? t(
                locale,
                `\n\n*(Nota: Como aún no son 1er grado, primero enviaremos la solicitud de conexión y, apenas acepte, podrás enviarle la propuesta completa).*`,
                `\n\n*(Note: Since you are not 1st degree yet, we will send the connection request first and then you can send the full proposal once accepted).*`,
                `\n\n*(Nota: Como ainda não são 1º grau, primeiro enviaremos a solicitação de conexão e, assim que aceitar, você poderá enviar a proposta).*`
              )
            : "";

        return NextResponse.json({
          ok: true,
          reply: t(
            locale,
            `Confirmado: **${person.name}** está en tu **${distLabel}**.${extraHint}\n\nPreparé esta **solicitud de conexión** para que la apruebes:`,
            `Confirmed: **${person.name}** is a **${distLabel}** connection.${extraHint}\n\nI prepared this **connection request** for your approval:`,
            `Confirmado: **${person.name}** está no seu **${distLabel}**.${extraHint}\n\nPreparei esta **solicitação de conexão** para sua aprovação:`
          ),
          spokenText: t(
            locale,
            `${person.name} está en ${distLabel}. Preparé la solicitud de conexión para tu aprobación.`,
            `${person.name} is ${distLabel}. I prepared the connection request for your approval.`,
            `${person.name} está em ${distLabel}. Preparei a solicitação de conexão para sua aprovação.`
          ),
          emotion: "talking",
          cards: [{ type: "approval", data: { approval } }],
        } as BotCommandResponse);
      }
    }

    if (action === "reject_profile") {
      const remaining = Array.isArray(payload.remaining)
        ? (payload.remaining as VerifiedPersonCandidate[])
        : [];
      if (remaining.length > 0) {
        return NextResponse.json({
          ok: true,
          reply: t(
            locale,
            `Entendido, descartado. Aquí tienes la siguiente coincidencia encontrada en LinkedIn. **¿Es esta la persona?**`,
            `Got it, skipped. Here is the next match found on LinkedIn. **Is this the right person?**`,
            `Entendido, descartado. Aqui está a próxima correspondência encontrada no LinkedIn. **É essa pessoa?**`
          ),
          spokenText: t(
            locale,
            `Te muestro la siguiente coincidencia para confirmar.`,
            `Showing the next match for confirmation.`,
            `Mostrando a próxima correspondência para confirmar.`
          ),
          emotion: "thinking",
          cards: [
            {
              type: "profile_verify",
              data: {
                candidates: remaining,
                intendedAction: payload.intendedAction || "auto",
                userContext: payload.userContext || "",
              },
            },
          ],
        } as BotCommandResponse);
      }

      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `De acuerdo, no actuaré sobre ese perfil. Por favor dime el **nombre completo + empresa**, ciudad o pega su **URL de LinkedIn** para buscar exactamente a la persona correcta.`,
          `Understood, I won't act on that profile. Please share their **full name + company**, city, or paste their **LinkedIn URL** so I can find the exact person.`,
          `Combinado, não farei nada nesse perfil. Por favor me informe o **nome completo + empresa**, cidade ou cole a **URL do LinkedIn** para buscar a pessoa certa.`
        ),
        spokenText: t(
          locale,
          `Dime su empresa o URL de LinkedIn para buscar de nuevo.`,
          `Tell me their company or LinkedIn URL so I can search again.`,
          `Informe a empresa ou URL do LinkedIn para eu buscar novamente.`
        ),
        emotion: "idle",
      } as BotCommandResponse);
    }

    if ((action === "approve_action" || action === "schedule_action") && payload?.approval) {
      const approval = payload.approval as ApprovalActionPayload;
      const scheduledAt =
        action === "schedule_action" && payload.scheduledAt
          ? String(payload.scheduledAt)
          : undefined;

      const execRes = await executeApprovedAction(approval, scheduledAt, locale);
      return NextResponse.json({
        ok: execRes.ok,
        reply: execRes.ok
          ? `✅ **${t(locale, "Listo.", "Done.", "Pronto.")}** ${execRes.message}`
          : `⚠️ ${t(
              locale,
              "No pude completar la acción:",
              "Could not complete the action:",
              "Não consegui concluir a ação:"
            )} ${execRes.message}`,
        spokenText: execRes.ok
          ? t(locale, "Acción ejecutada con éxito.", "Action executed successfully.", "Ação executada com sucesso.")
          : t(locale, "No se pudo completar la acción.", "Could not complete the action.", "Não foi possível concluir a ação."),
        emotion: execRes.ok ? "happy" : "thinking",
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (action === "discard_action") {
      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          "🗑️ **Acción descartada.** No se publicó ni se envió nada en tu cuenta de LinkedIn.",
          "🗑️ **Action discarded.** Nothing was published or sent from your LinkedIn account.",
          "🗑️ **Ação descartada.** Nada foi publicado ou enviado na sua conta do LinkedIn."
        ),
        spokenText: t(locale, "Acción descartada.", "Action discarded.", "Ação descartada."),
        emotion: "idle",
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    // =========================================================================
    // 2. FAST-PATH DETERMINÍSTICO SOLO PARA COMANDOS EXPLÍCITOS DE DATOS EN VIVO
    // =========================================================================
    const isStrategicQuestion =
      /^(c[oó]mo|qu[eé]|por qu[eé]|cu[aá]l|cu[aá]ndo|para qu[eé]|how |what |why |when |como |o que |por que )/i.test(
        lower
      ) && !/c[oó]mo van las campa|como est[aã]o as campanhas|how are campaigns/i.test(lower);

    if (
      !imageBase64 &&
      !isStrategicQuestion &&
      (action === "get_summary" ||
        /^(dame el |give me |me d[eê] o )?(resumen( de hoy| del d[ií]a)?|estado general|mis m[eé]tricas|reporte de hoy|today'?s summary|summary|resumo( de hoje| do dia)?)[!?.]*$/i.test(
          lower
        ))
    ) {
      const snap = getPlatformSummary();
      const accountsOk = snap.accounts.active > 0;
      const reply = t(
        locale,
        [
          `Aquí tienes el **resumen ejecutivo** de tu plataforma InhubFlow:`,
          `\n* **Cuentas de LinkedIn:** ${snap.accounts.active} activas (${snap.accounts.total} registradas).`,
          `* **Prospectos en CRM:** ${snap.leads.total} captados (${snap.leads.qualified} con alta intención comercial).`,
          `* **Campañas de Secuencia:** ${snap.campaigns.active} activas de ${snap.campaigns.total} totales.`,
          `* **Publicaciones:** ${snap.posts.published} publicadas, ${snap.posts.scheduled} programadas y ${snap.posts.draft} en borrador.`,
          `* **Signal Radar:** ${snap.signals.active} monitores escaneando activamente.`,
          `* **Actividad de Hoy:** ${snap.pacingToday.invites} invitaciones y ${snap.pacingToday.dms} mensajes enviados.`,
          `\n${accountsOk ? "¿Qué acción estratégica deseas ejecutar ahora?" : "Recuerda conectar una cuenta de LinkedIn para operar en vivo."}`,
        ].join("\n"),
        [
          `Here is your InhubFlow **executive summary**:`,
          `\n* **LinkedIn Accounts:** ${snap.accounts.active} active (${snap.accounts.total} registered).`,
          `* **CRM Prospects:** ${snap.leads.total} captured (${snap.leads.qualified} high buying intent).`,
          `* **Sequence Campaigns:** ${snap.campaigns.active} active out of ${snap.campaigns.total} total.`,
          `* **Posts:** ${snap.posts.published} published, ${snap.posts.scheduled} scheduled, ${snap.posts.draft} drafts.`,
          `* **Signal Radar:** ${snap.signals.active} monitors actively scanning.`,
          `* **Today's Activity:** ${snap.pacingToday.invites} invites and ${snap.pacingToday.dms} messages sent.`,
          `\n${accountsOk ? "What would you like to execute next?" : "Remember to connect a LinkedIn account to operate live."}`,
        ].join("\n"),
        [
          `Aqui está o **resumo executivo** da sua plataforma InhubFlow:`,
          `\n* **Contas do LinkedIn:** ${snap.accounts.active} ativas (${snap.accounts.total} registradas).`,
          `* **Prospects no CRM:** ${snap.leads.total} captados (${snap.leads.qualified} com alta intenção).`,
          `* **Campanhas de Sequência:** ${snap.campaigns.active} ativas de ${snap.campaigns.total} totais.`,
          `* **Publicações:** ${snap.posts.published} publicadas, ${snap.posts.scheduled} agendadas e ${snap.posts.draft} em rascunho.`,
          `* **Signal Radar:** ${snap.signals.active} monitores escaneando ativamente.`,
          `* **Atividade de Hoje:** ${snap.pacingToday.invites} convites e ${snap.pacingToday.dms} mensagens enviadas.`,
          `\n${accountsOk ? "Qual ação estratégica deseja executar agora?" : "Lembre-se de conectar uma conta do LinkedIn para operar ao vivo."}`,
        ].join("\n")
      );

      return NextResponse.json({
        ok: true,
        reply,
        spokenText: t(
          locale,
          `Tienes ${snap.leads.total} prospectos en CRM y ${snap.campaigns.active} campañas activas.`,
          `You have ${snap.leads.total} CRM prospects and ${snap.campaigns.active} active campaigns.`,
          `Você tem ${snap.leads.total} prospects no CRM e ${snap.campaigns.active} campanhas ativas.`
        ),
        emotion: "talking",
        cards: [{ type: "summary", data: snap }],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      !isStrategicQuestion &&
      (action === "list_campaigns" ||
        /^(c[oó]mo van las campa[ñn]as|ver campa[ñn]as|estado de campa[ñn]as|mis campa[ñn]as|how are campaigns( going)?|view campaigns|como est[aã]o as campanhas|ver campanhas|minhas campanhas)[!?.]*$/i.test(
          lower
        ))
    ) {
      const campaigns = getCampaignsList();
      const activeCount = campaigns.filter((c) => c.status === "active").length;
      return NextResponse.json({
        ok: true,
        reply:
          campaigns.length > 0
            ? t(
                locale,
                `Tienes **${campaigns.length} campañas configuradas** (${activeCount} activas). Puedes pausar o activar cualquiera directamente desde aquí:`,
                `You have **${campaigns.length} campaigns configured** (${activeCount} active). You can pause or activate any right here:`,
                `Você tem **${campaigns.length} campanhas configuradas** (${activeCount} ativas). Pode pausar ou ativar qualquer uma por aqui:`
              )
            : t(
                locale,
                "Aún no tienes campañas lineales creadas en tu dashboard.",
                "You don't have any linear campaigns created yet.",
                "Você ainda não tem campanhas lineares criadas no dashboard."
              ),
        spokenText: t(
          locale,
          `Tienes ${activeCount} campañas activas de ${campaigns.length}.`,
          `You have ${activeCount} active campaigns out of ${campaigns.length}.`,
          `Você tem ${activeCount} campanhas ativas de ${campaigns.length}.`
        ),
        emotion: "talking",
        cards: campaigns.length > 0 ? [{ type: "campaigns", data: { campaigns } }] : [],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      !isStrategicQuestion &&
      /^(ver |mu[eé]strame los )?([uú]ltimos prospectos|prospectos del radar|ver prospectos|leads del radar|latest radar prospects|radar prospects|recent leads|[uú]ltimos prospects|prospects do radar)[!?.]*$/i.test(
        lower
      )
    ) {
      const leads = getRecentLeads();
      return NextResponse.json({
        ok: true,
        reply:
          leads.length > 0
            ? t(
                locale,
                `Aquí tienes los **últimos prospectos con alta intención** captados por Signal Radar y secuencias:`,
                `Here are the **latest high-intent prospects** captured by Signal Radar and sequences:`,
                `Aqui estão os **últimos prospects com alta intenção** captados pelo Signal Radar e sequências:`
              )
            : t(
                locale,
                "Aún no hay prospectos registrados en tu CRM.",
                "No prospects recorded in your CRM yet.",
                "Ainda não há prospects registrados no seu CRM."
              ),
        spokenText: t(
          locale,
          leads.length > 0 ? `Se han detectado ${leads.length} prospectos clave.` : "Sin nuevos prospectos por el momento.",
          leads.length > 0 ? `Found ${leads.length} key prospects in your CRM.` : "No new prospects at the moment.",
          leads.length > 0 ? `Foram detectados ${leads.length} prospects no CRM.` : "Sem novos prospects no momento."
        ),
        emotion: "talking",
        cards: leads.length > 0 ? [{ type: "leads", data: { leads } }] : [],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      !isStrategicQuestion &&
      /^(estado de mi cuenta|estado de cuentas|estado de mi cuenta de linkedin|linkedin account status|account status|status da minha conta|status da minha conta do linkedin)[!?.]*$/i.test(
        lower
      )
    ) {
      const snap = getPlatformSummary();
      const isConnected = snap.accounts.active > 0;
      return NextResponse.json({
        ok: true,
        reply: isConnected
          ? t(
              locale,
              "Tu cuenta de LinkedIn está **conectada y operativa**, respetando el pacing diario seguro de lunes a viernes.",
              "Your LinkedIn account is **connected and active**, operating within safe Mon–Fri daily pacing limits.",
              "Sua conta do LinkedIn está **conectada e operacional**, respeitando os limites seguros diários de segunda a sexta."
            )
          : t(
              locale,
              "No tienes ninguna cuenta de LinkedIn activa en este momento. Conéctala en **Cuentas de LinkedIn** del dashboard.",
              "You don't have an active LinkedIn account right now. Connect one under **LinkedIn Accounts** in the dashboard.",
              "Você não tem nenhuma conta do LinkedIn ativa no momento. Conecte uma em **Contas do LinkedIn** no dashboard."
            ),
        spokenText: isConnected
          ? t(locale, "Tu cuenta de LinkedIn está conectada y protegida.", "Your LinkedIn account is connected and protected.", "Sua conta do LinkedIn está conectada e protegida.")
          : t(locale, "Conecta tu cuenta de LinkedIn para comenzar.", "Connect your LinkedIn account to get started.", "Conecte sua conta do LinkedIn para começar."),
        emotion: isConnected ? "talking" : "thinking",
        cards: [{ type: "accounts", data: snap.accounts }],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    // =========================================================================
    // 3. FLUJO MULTIMODAL CON FOTO / IMAGEN
    // =========================================================================
    const kb = getApprovedKnowledgeContext();

    if (imageBase64 && imageMimeType) {
      const isImageFile = imageMimeType.toLowerCase().startsWith("image/");
      const modeled = await generatePostApprovalData({
        topicOrInstruction:
          message ||
          t(
            locale,
            "Analiza este artículo o archivo adjunto y modélalo en un post de autoridad enfocado en nuestras soluciones y propuesta de valor.",
            "Analyze this attached article or file and model it into an authority post focused on our solutions and value proposition.",
            "Analise este artigo ou arquivo anexado e modele um post de autoridade focado em nossas soluções e proposta de valor."
          ),
        kbContext: kb.contextText,
        companyName: kb.companyName,
        locale,
        imageBase64,
        imageMimeType,
        attachmentName: fileName,
      });

      const approval: ApprovalActionPayload = {
        type: "post",
        title: modeled.title,
        preview: modeled.content,
      };

      const companyLabel = kb.companyName || t(locale, "tu empresa", "your company", "sua empresa");
      const docLabel = fileName || (isImageFile ? "imagen" : "archivo");
      return NextResponse.json({
        ok: true,
        reply: isImageFile
          ? t(
              locale,
              `📸 **Analicé tu imagen** y modelé una publicación alineada a **${companyLabel}**.\n\n*${modeled.summaryNote}*\n\nComo regla de oro, **nunca publico solo**: revisa, edita, agenda o aprueba aquí:`,
              `📸 **I analyzed your image** and modeled a post tailored to **${companyLabel}**.\n\n*${modeled.summaryNote}*\n\nAs a golden rule, **I never publish without your OK**: review, edit, schedule, or approve below:`,
              `📸 **Analisei sua imagem** e modelei uma publicação alinhada à **${companyLabel}**.\n\n*${modeled.summaryNote}*\n\nComo regra de ouro, **nunca publico sozinho**: revise, edite, agende ou aprove abaixo:`
            )
          : t(
              locale,
              `📎 **Analicé el archivo "${docLabel}"** y modelé una publicación enfocada en la propuesta de valor de **${companyLabel}**.\n\n*${modeled.summaryNote}*\n\nComo regla de oro, **nunca publico solo**: revisa, edita, agenda o aprueba aquí:`,
              `📎 **I analyzed "${docLabel}"** and modeled a post focused on **${companyLabel}**'s value proposition.\n\n*${modeled.summaryNote}*\n\nAs a golden rule, **I never publish without your OK**: review, edit, schedule, or approve below:`,
              `📎 **Analisei o arquivo "${docLabel}"** e modelei uma publicação focada na proposta de valor da **${companyLabel}**.\n\n*${modeled.summaryNote}*\n\nComo regra de ouro, **nunca publico sozinho**: revise, edite, agende ou aprove abaixo:`
            ),
        spokenText: t(
          locale,
          "Analicé el archivo y preparé el borrador del post para tu aprobación.",
          "I analyzed the file and drafted the post for your approval.",
          "Analisei o arquivo e preparei o rascunho do post para sua aprovação."
        ),
        emotion: "excited",
        cards: [{ type: "approval", data: { approval } }],
      } as BotCommandResponse);
    }

    // =========================================================================
    // 4. ENRUTAMIENTO INTELIGENTE CON GEMINI
    // =========================================================================
    const classified = await classifyBotIntent(message, history, kb.contextText);

    if (classified.intent === "person_outreach" && classified.personQuery) {
      const searchRes = await searchLinkedInPeopleForVerification(classified.personQuery);

      if (!searchRes.ok && searchRes.error) {
        return NextResponse.json({
          ok: true,
          reply: t(
            locale,
            "⚠️ No tienes una cuenta de LinkedIn conectada y activa en este momento. Conecta tu perfil en el dashboard para buscar personas en tiempo real.",
            "⚠️ You don't have an active LinkedIn account connected right now. Connect your profile in the dashboard to search people live.",
            "⚠️ Você não tem uma conta do LinkedIn conectada e ativa no momento. Conecte seu perfil no dashboard para buscar pessoas em tempo real."
          ),
          emotion: "thinking",
        } as BotCommandResponse);
      }

      if (searchRes.candidates.length === 0) {
        return NextResponse.json({
          ok: true,
          reply: t(
            locale,
            `No encontré coincidencias claras para **"${classified.personQuery}"** en LinkedIn.\n\nIntenta darme su **nombre completo + empresa**, o pega directamente la **URL de su perfil de LinkedIn**.`,
            `I couldn't find clear matches for **"${classified.personQuery}"** on LinkedIn.\n\nTry sharing their **full name + company**, or paste their **LinkedIn profile URL**.`,
            `Não encontrei correspondências claras para **"${classified.personQuery}"** no LinkedIn.\n\nTente informar **nome completo + empresa**, ou cole diretamente a **URL do perfil no LinkedIn**.`
          ),
          spokenText: t(
            locale,
            `No encontré coincidencias para ${classified.personQuery}.`,
            `No matches found for ${classified.personQuery}.`,
            `Não encontrei correspondências para ${classified.personQuery}.`
          ),
          emotion: "thinking",
        } as BotCommandResponse);
      }

      const count = searchRes.candidates.length;
      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `🔎 Encontré ${count === 1 ? "este perfil" : `${count} posibles coincidencias`} en LinkedIn. **Antes de realizar cualquier acción, confírmame si es la persona correcta:**`,
          `🔎 I found ${count === 1 ? "this profile" : `${count} possible matches`} on LinkedIn. **Before taking any action, please confirm if this is the right person:**`,
          `🔎 Encontrei ${count === 1 ? "este perfil" : `${count} possíveis correspondências`} no LinkedIn. **Antes de agir, confirme se é a pessoa certa:**`
        ),
        spokenText: t(
          locale,
          `Encontré a ${searchRes.candidates[0].name}. Confirma en pantalla si es la persona correcta.`,
          `I found ${searchRes.candidates[0].name}. Please confirm on screen if that's the right person.`,
          `Encontrei ${searchRes.candidates[0].name}. Confirme na tela se é a pessoa certa.`
        ),
        emotion: "talking",
        cards: [
          {
            type: "profile_verify",
            data: {
              candidates: searchRes.candidates,
              intendedAction: classified.intendedAction || "auto",
              userContext: classified.userContext || message,
            },
          },
        ],
      } as BotCommandResponse);
    }

    if (classified.intent === "create_viral_post") {
      const topic = classified.topic || message;
      let referencePostsText = "";

      if (classified.searchViralFirst) {
        const { accountId } = await resolveActiveLinkedInAccount();
        let viralItems: Array<{ text?: string; reaction_counter?: number; comment_counter?: number }> = [];

        if (accountId && unipile.isConfigured()) {
          try {
            const res = await unipile.searchLinkedIn({
              account_id: accountId,
              category: "posts",
              keywords: topic.slice(0, 60),
              limit: 12,
            });
            viralItems = (res.items || []) as Array<{
              text?: string;
              reaction_counter?: number;
              comment_counter?: number;
            }>;
          } catch {}
        }

        if (viralItems.length === 0) {
          viralItems = getNicheViralPosts(topic, "latam_us", "ALL")
            .slice(0, 5)
            .map((item) => ({
              text: item.fullContent,
              reaction_counter: item.likes,
              comment_counter: item.comments,
            }));
        }

        referencePostsText = viralItems
          .slice(0, 5)
          .map(
            (p, idx) =>
              `Post #${idx + 1} (${p.reaction_counter || 0} likes, ${p.comment_counter || 0} comments):\n${String(
                p.text || ""
              ).slice(0, 350)}`
          )
          .join("\n---\n");
      }

      const recentPostContext = history
        .slice(-3)
        .map((h) => `${h.sender === "user" ? "User" : "Assistant"}: ${String(h.text || "").slice(0, 500)}`)
        .join("\n");

      const modeled = await generatePostApprovalData({
        topicOrInstruction: recentPostContext
          ? `Contexto reciente:\n${recentPostContext}\n\nNueva instrucción del usuario:\n${message}`
          : message,
        kbContext: kb.contextText,
        companyName: kb.companyName,
        locale,
        referencePostsText,
      });

      const approval: ApprovalActionPayload = {
        type: "post",
        title: modeled.title,
        preview: modeled.content,
        scheduledAt: classified.scheduledDateIso || undefined,
      };

      const companyLabel = kb.companyName || t(locale, "tu empresa", "your company", "sua empresa");
      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `✍️ **Preparé este borrador** ${
            referencePostsText ? "analizando los posts con mayor tracción del tema y " : ""
          }usando la voz de **${companyLabel}**.\n\n*${modeled.summaryNote}*\n\nRevisa y elige si quieres **Publicar ahora**, **Editar**, **Agendar** o **Descartar**:`,
          `✍️ **I drafted this post** ${
            referencePostsText ? "after analyzing top-performing posts on the topic and " : ""
          }using **${companyLabel}**'s voice.\n\n*${modeled.summaryNote}*\n\nReview and choose whether to **Publish now**, **Edit**, **Schedule**, or **Discard**:`,
          `✍️ **Preparei este rascunho** ${
            referencePostsText ? "analisando os posts com maior tração do tema e " : ""
          }usando a voz da **${companyLabel}**.\n\n*${modeled.summaryNote}*\n\nRevise e escolha **Publicar agora**, **Editar**, **Agendar** ou **Descartar**:`
        ),
        spokenText: t(
          locale,
          "Preparé tu publicación de LinkedIn. Revísala para aprobarla, editarla o agendarla.",
          "I drafted your LinkedIn post. Review it to approve, edit, or schedule.",
          "Preparei sua publicação do LinkedIn. Revise para aprovar, editar ou agendar."
        ),
        emotion: "excited",
        cards: [{ type: "approval", data: { approval } }],
      } as BotCommandResponse);
    }

    // =========================================================================
    // 5. CONVERSACIÓN GENERAL / ESTRATEGIA CON GEMINI + CONOCIMIENTO TOTAL
    // =========================================================================
    const snap = getPlatformSummary();
    const campaignsList = getCampaignsList();
    const topLeads = getRecentLeads();
    const turns = buildHistoryTurns(history);
    turns.push({ role: "user", parts: [{ text: message || "Hello" }] });

    const liveWorkspaceSummary = [
      `- Cuentas LinkedIn activas: ${snap.accounts.active}/${snap.accounts.total}`,
      `- Prospectos CRM: ${snap.leads.total} (${snap.leads.qualified} con alta intención >= 80 pts)`,
      topLeads.length > 0
        ? `  Últimos leads: ${topLeads.map((l) => `${l.name} (${l.headline}, ${l.score} pts, etapa ${l.stage})`).join(" | ")}`
        : "",
      `- Campañas: ${snap.campaigns.active}/${snap.campaigns.total} activas`,
      campaignsList.length > 0
        ? `  Nombres: ${campaignsList.map((c) => `${c.name} [${c.status}]`).join(", ")}`
        : "",
      `- Posts: ${snap.posts.published} publicados, ${snap.posts.scheduled} programados, ${snap.posts.draft} borradores`,
      `- Monitores Signal Radar activos: ${snap.signals.active}/${snap.signals.total}`,
      `- Pacing hoy: ${snap.pacingToday.invites} invitaciones, ${snap.pacingToday.dms} DMs`,
    ]
      .filter(Boolean)
      .join("\n");

    const aiReply = await callGeminiMultimodal({
      systemPrompt: `You are "InhubBot", InhubFlow's intelligent AI partner & mobile Social Selling Assistant.
CRITICAL: Always reply strictly in ${langName} (${locale}). Be insightful, strategic, clear, practical, and easy to read on a mobile screen.

YOUR ROLE:
You are NOT a generic chatbot. You are:
1. A deep expert on **every single module, rule, limit, and workflow inside InhubFlow Social Selling Suite**.
2. A senior **LinkedIn, Personal Branding, Copywriting & B2B Social Selling strategist** who thinks critically, gives actionable advice, diagnoses bottlenecks, rewrites hooks/profiles, and proposes concrete next steps.
3. A hands-free mobile operator with Human-in-the-Loop protection (you can analyze magazine/article photos, search LinkedIn people with profile photo & connection degree verification, draft comments/DMs/posts for human approval, and inspect live workspace metrics).

GOLDEN RULE: Never fabricate live metrics. Use ONLY the real workspace snapshot below for account numbers, and clearly distinguish real account data from strategic LinkedIn advice.

${INHUBFLOW_MASTER_KNOWLEDGE}

=== LIVE WORKSPACE SNAPSHOT ===
${liveWorkspaceSummary}

=== COMPANY KNOWLEDGE BASE (RAG - ${kb.companyName || "InhubFlow"}) ===
${kb.contextText.slice(0, 3500)}`,
      turns,
      temperature: 0.72,
      maxOutputTokens: 900,
    });

    const finalReply =
      aiReply.ok && aiReply.text
        ? aiReply.text
        : t(
            locale,
            `Entendido. Puedo ayudarte a buscar personas en LinkedIn, comentar su último post, modelar un post desde una foto o ver el resumen de hoy. ¿Qué hacemos ahora?`,
            `Got it. I can help you find people on LinkedIn, comment on their latest post, model a post from a photo, or check today's summary. What should we do next?`,
            `Entendido. Posso ajudar a buscar pessoas no LinkedIn, comentar no último post delas, modelar um post a partir de uma foto ou ver o resumo de hoje. O que fazemos agora?`
          );

    return NextResponse.json({
      ok: true,
      reply: finalReply,
      spokenText: finalReply.replace(/[*_#`[\]()]/g, "").slice(0, 220),
      emotion: "talking",
      quickActions: ui.quickActions,
    } as BotCommandResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bot command error";
    console.error("[Bot Command API Error]:", error);
    return NextResponse.json(
      {
        ok: false,
        reply: message,
        spokenText: message,
        emotion: "thinking",
      },
      { status: 500 }
    );
  }
}
