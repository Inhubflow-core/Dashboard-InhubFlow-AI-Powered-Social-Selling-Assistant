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
import type { DashboardPresencePayload } from "@/lib/bot/dashboard-presence";
import { INHUBFLOW_MASTER_KNOWLEDGE } from "@/lib/bot/platform-knowledge";
import { getSocialSellingDb } from "@/lib/persistence/db";
import { unipile } from "@/lib/unipile/client";
import { getNicheViralPosts } from "@/lib/viral-posts/niche-search";
import { NextRequest, NextResponse } from "next/server";

export interface BotActionCard {
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
  data: Record<string, unknown>;
}

interface BotCommandResponse {
  ok: boolean;
  reply: string;
  emotion: "idle" | "talking" | "thinking" | "happy" | "excited";
  cards?: BotActionCard[];
  quickActions?: string[];
  spokenText?: string;
  executedApproval?: {
    messageId: string;
    cardIdx: number;
    status: "approved" | "scheduled";
  };
  syncedPost?: Record<string, unknown>;
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
    const rows = db.prepare("SELECT * FROM crm_leads_360 ORDER BY created_at DESC LIMIT 12").all() as Array<{
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

interface StoredViralPostSummary {
  [key: string]: unknown;
  id: string;
  title: string;
  content: string;
  format: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt?: string;
  linkedinPostId?: string;
  postUrl?: string;
  targetAccountId?: string;
}

function getViralPostsList(limit = 15): StoredViralPostSummary[] {
  const db = getSocialSellingDb();
  try {
    const rows = db
      .prepare(
        "SELECT * FROM viral_posts ORDER BY COALESCE(published_at, scheduled_at, created_at) DESC LIMIT ?"
      )
      .all(limit) as Array<Record<string, any>>;

    return rows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = r.metadata_json ? JSON.parse(String(r.metadata_json)) : {};
      } catch {}
      const linkedinPostId = r.linkedin_post_id ? String(r.linkedin_post_id) : undefined;
      let postUrl =
        (typeof r.post_url === "string" && r.post_url.startsWith("http") ? r.post_url : "") ||
        (typeof meta.postUrl === "string" && meta.postUrl.startsWith("http") ? String(meta.postUrl) : "");

      if (
        !postUrl &&
        linkedinPostId &&
        !linkedinPostId.startsWith("up_post_") &&
        !linkedinPostId.startsWith("post_sim_")
      ) {
        if (linkedinPostId.startsWith("urn:li:")) {
          postUrl = `https://www.linkedin.com/feed/update/${linkedinPostId}/`;
        } else if (/^\d+$/.test(linkedinPostId)) {
          postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${linkedinPostId}/`;
        }
      }

      return {
        id: String(r.id),
        title: String(r.title || "LinkedIn Post"),
        content: String(r.content || ""),
        format: String(r.format || "text"),
        status: String(r.status || "draft"),
        scheduledAt: r.scheduled_at ? String(r.scheduled_at) : undefined,
        publishedAt: r.published_at ? String(r.published_at) : undefined,
        createdAt: r.created_at ? String(r.created_at) : undefined,
        linkedinPostId,
        postUrl: postUrl || undefined,
        targetAccountId: r.target_account_id ? String(r.target_account_id) : undefined,
      };
    });
  } catch {
    return [];
  }
}

async function resolveMissingPostUrl(post: StoredViralPostSummary): Promise<string | undefined> {
  if (post.postUrl && post.postUrl.startsWith("http")) return post.postUrl;
  const rawId = post.linkedinPostId;
  if (!rawId || rawId.startsWith("up_post_") || rawId.startsWith("post_sim_")) {
    return undefined;
  }

  let resolvedUrl = "";
  try {
    const { accountId } = await resolveActiveLinkedInAccount();
    if (accountId && unipile.isConfigured() && !unipile.isSandboxMode()) {
      const livePost = await unipile.getPost(rawId, post.targetAccountId || accountId);
      if (livePost) {
        if (typeof livePost.share_url === "string" && livePost.share_url.startsWith("http")) {
          resolvedUrl = livePost.share_url;
        } else if (typeof (livePost as Record<string, unknown>).url === "string") {
          const u = String((livePost as Record<string, unknown>).url);
          if (u.startsWith("http")) resolvedUrl = u;
        }
      }
    }
  } catch {}

  if (!resolvedUrl) {
    if (rawId.startsWith("urn:li:")) {
      resolvedUrl = `https://www.linkedin.com/feed/update/${rawId}/`;
    } else if (/^\d+$/.test(rawId)) {
      resolvedUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${rawId}/`;
    }
  }

  if (resolvedUrl) {
    try {
      const db = getSocialSellingDb();
      db.prepare("UPDATE viral_posts SET post_url = ? WHERE id = ?").run(resolvedUrl, post.id);
    } catch {}
    return resolvedUrl;
  }
  return undefined;
}

function getSignalMonitorsList() {
  const db = getSocialSellingDb();
  try {
    const rows = db
      .prepare("SELECT id, level, title, status, leads_count, updated_at FROM signal_monitors ORDER BY updated_at DESC LIMIT 10")
      .all() as Array<{
      id: string;
      level: string;
      title: string;
      status: string;
      leads_count: number;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      level: r.level,
      title: r.title,
      status: r.status || "active",
      leadsCount: Number(r.leads_count || 0),
    }));
  } catch {
    return [];
  }
}

function toggleSignalMonitorStatus(signalId: string, targetStatus: "active" | "paused") {
  const db = getSocialSellingDb();
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE signal_monitors SET status = ?, updated_at = ? WHERE id = ?").run(
      targetStatus,
      now,
      signalId
    );
    return true;
  } catch {
    return false;
  }
}

function createSignalMonitor(title: string, level = "level_3") {
  const db = getSocialSellingDb();
  const id = `sig-bot-${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO signal_monitors (id, level, title, status, leads_count, created_at, updated_at, metadata_json)
     VALUES (?, ?, ?, 'active', 0, ?, ?, ?)`
  ).run(id, level, title, now, now, JSON.stringify({ source: "inhub_bot" }));
  return { id, level, title, status: "active", leadsCount: 0 };
}

function createLinearCampaignInDb(name: string, icebreaker: string) {
  const db = getSocialSellingDb();
  const id = `camp-bot-${Date.now()}`;
  const now = new Date().toISOString();
  const code = `CAMP-${String(Date.now()).slice(-4)}`;
  const metadata = {
    name,
    code,
    status: "active",
    icebreaker,
    source: "inhub_bot",
    leadsCount: 0,
  };
  db.prepare(
    `INSERT INTO linear_campaigns (id, name, code, status, created_at, updated_at, metadata_json)
     VALUES (?, ?, ?, 'active', ?, ?, ?)`
  ).run(id, name, code, now, now, JSON.stringify(metadata));
  return { id, name, code, status: "active", leadsCount: 0 };
}

function getInboxOverview() {
  const db = getSocialSellingDb();
  try {
    const rows = db
      .prepare("SELECT id, lead_name, crm_stage_id, unread, updated_at, metadata_json FROM inbox_conversations_v2 ORDER BY updated_at DESC LIMIT 6")
      .all() as Array<{
      id: string;
      lead_name: string;
      crm_stage_id?: string;
      unread: number;
      updated_at: string;
      metadata_json?: string;
    }>;

    const totalRow = db.prepare("SELECT COUNT(*) as c FROM inbox_conversations_v2").get() as { c: number } | undefined;
    const unreadRow = db
      .prepare("SELECT COUNT(*) as c FROM inbox_conversations_v2 WHERE unread > 0")
      .get() as { c: number } | undefined;

    let pendingSdrDrafts = 0;
    try {
      const pendingRow = db
        .prepare("SELECT payload_json FROM sdr_state_v2 WHERE key = 'pending'")
        .get() as { payload_json: string } | undefined;
      if (pendingRow?.payload_json) {
        const list = JSON.parse(pendingRow.payload_json);
        if (Array.isArray(list)) {
          pendingSdrDrafts = list.filter((i) => i?.status === "pending").length;
        }
      }
    } catch {}

    const conversations = rows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch {}
      return {
        id: r.id,
        leadName: r.lead_name,
        stage: r.crm_stage_id || String(meta.stage || "engaged"),
        unread: Number(r.unread || 0),
        lastMessage: String(meta.lastMessage || meta.last_message || meta.snippet || ""),
        updatedAt: r.updated_at,
      };
    });

    return {
      total: Number(totalRow?.c || 0),
      unreadCount: Number(unreadRow?.c || 0),
      pendingSdrDrafts,
      conversations,
    };
  } catch {
    return { total: 0, unreadCount: 0, pendingSdrDrafts: 0, conversations: [] };
  }
}

function getPipelineOverview() {
  const db = getSocialSellingDb();
  try {
    const stageRows = db
      .prepare("SELECT stage, COUNT(*) as count FROM crm_leads_360 GROUP BY stage ORDER BY count DESC")
      .all() as Array<{ stage: string; count: number }>;
    const topRows = db
      .prepare("SELECT id, full_name, stage, intent_score, metadata_json FROM crm_leads_360 ORDER BY intent_score DESC, created_at DESC LIMIT 5")
      .all() as Array<{
      id: string;
      full_name: string;
      stage: string;
      intent_score: number;
      metadata_json?: string;
    }>;

    const total = stageRows.reduce((acc, s) => acc + Number(s.count || 0), 0);
    const stages = stageRows.map((s) => ({
      stage: s.stage || "lead_captured",
      count: Number(s.count || 0),
    }));
    const topLeads = topRows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch {}
      return {
        id: r.id,
        name: r.full_name,
        headline: String(meta.headline || meta.title || "B2B Prospect"),
        stage: r.stage,
        score: Number(r.intent_score || 0),
      };
    });

    return { total, stages, topLeads };
  } catch {
    return { total: 0, stages: [], topLeads: [] };
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

function getDashboardPresence(userId?: string): {
  presence: DashboardPresencePayload | null;
  ageSeconds: number | null;
  ageLabel: string;
} {
  try {
    const db = getSocialSellingDb();
    const readByKey = (key: string): DashboardPresencePayload | null => {
      const row = db
        .prepare("SELECT payload_json FROM workspace_settings_v2 WHERE key = ?")
        .get(key) as { payload_json?: string } | undefined;
      if (!row?.payload_json) return null;
      const parsed = JSON.parse(row.payload_json) as DashboardPresencePayload;
      return parsed?.pathname ? parsed : null;
    };

    const presence = (userId ? readByKey(`presence:${userId}`) : null) || readByKey("presence:latest");
    if (!presence) {
      return { presence: null, ageSeconds: null, ageLabel: "" };
    }
    const updatedMs = new Date(presence.updatedAt).getTime();
    const ageSeconds = Number.isNaN(updatedMs)
      ? null
      : Math.max(0, Math.floor((Date.now() - updatedMs) / 1000));
    const ageLabel =
      ageSeconds === null
        ? ""
        : ageSeconds < 60
          ? `${ageSeconds}s`
          : ageSeconds < 3600
            ? `${Math.floor(ageSeconds / 60)} min`
            : `${Math.floor(ageSeconds / 3600)} h`;

    return { presence, ageSeconds, ageLabel };
  } catch {
    return { presence: null, ageSeconds: null, ageLabel: "" };
  }
}

async function getLinkedInAccountsDetails(): Promise<
  Array<{ name: string; status: string; id: string; email?: string }>
> {
  const byId = new Map<string, { name: string; status: string; id: string; email?: string }>();
  if (unipile.isConfigured() && !unipile.isSandboxMode()) {
    try {
      const res = await unipile.listAccounts();
      for (const acc of res.items || []) {
        const provider = String(acc.type || acc.provider || "LINKEDIN").toUpperCase();
        if (provider !== "LINKEDIN") continue;
        byId.set(String(acc.id), {
          id: String(acc.id),
          name: String(acc.name || "LinkedIn"),
          status: String(acc.status || "UNKNOWN"),
        });
      }
    } catch {}
  }

  try {
    const db = getSocialSellingDb();
    const rows = db
      .prepare("SELECT id, unipile_account_id, name, status, payload_json FROM linkedin_accounts_v2 ORDER BY updated_at DESC")
      .all() as Array<{ id: string; unipile_account_id?: string; name: string; status: string; payload_json?: string }>;
    for (const r of rows) {
      let email: string | undefined;
      let realStatus = r.status;
      try {
        const p = r.payload_json ? JSON.parse(r.payload_json) : {};
        if (p?.email) email = String(p.email);
        if (p?.status) realStatus = String(p.status);
      } catch {}
      const cleanId = String(r.unipile_account_id || r.id).replace(/^acc-li-/, "");
      if (!byId.has(cleanId)) {
        byId.set(cleanId, { id: cleanId, name: r.name, status: realStatus, email });
      } else if (email) {
        const existing = byId.get(cleanId)!;
        existing.email = email;
      }
    }
  } catch {}

  return Array.from(byId.values());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const locale = getBotLocale(typeof body.locale === "string" ? body.locale : undefined);
    const ui = BOT_UI_LABELS[locale];
    const langName = getLocaleDisplayName(locale);
    const message = String(body.message || "").trim();
    const action = String(body.action || "").trim();
    const dashboardUserId = typeof body.userId === "string" ? body.userId.trim() : undefined;
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

    if (action === "toggle_signal" && payload?.signalId && payload?.status) {
      const ok = toggleSignalMonitorStatus(
        String(payload.signalId),
        payload.status === "active" ? "active" : "paused"
      );
      const signals = getSignalMonitorsList();
      const isActivating = payload.status === "active";
      const sigTitle = String(payload.signalTitle || payload.signalId);
      const statusText = isActivating
        ? t(locale, "activado", "activated", "ativado")
        : t(locale, "pausado", "paused", "pausado");

      return NextResponse.json({
        ok,
        reply: t(
          locale,
          `Listo. El monitor de señal **${sigTitle}** fue **${statusText}**.`,
          `Done. Signal monitor **${sigTitle}** has been **${statusText}**.`,
          `Pronto. O monitor de sinal **${sigTitle}** foi **${statusText}**.`
        ),
        spokenText: t(
          locale,
          `Monitor ${statusText} correctamente.`,
          `Monitor ${statusText} successfully.`,
          `Monitor ${statusText} com sucesso.`
        ),
        emotion: "talking",
        cards: [{ type: "signals", data: { signals } }],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (action === "create_signal") {
      const kb = getApprovedKnowledgeContext();
      const title =
        String(payload?.title || "").trim() ||
        t(
          locale,
          `Radar de intención · ${kb.companyName || "Social Selling B2B"}`,
          `Intent Radar · ${kb.companyName || "B2B Social Selling"}`,
          `Radar de intenção · ${kb.companyName || "Social Selling B2B"}`
        );
      createSignalMonitor(title, "level_3");
      const signals = getSignalMonitorsList();
      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `✅ Monitor **"${title}"** creado y **activado** en Signal Radar.`,
          `✅ Monitor **"${title}"** created and **activated** in Signal Radar.`,
          `✅ Monitor **"${title}"** criado e **ativado** no Signal Radar.`
        ),
        spokenText: t(
          locale,
          "Monitor de señales activado.",
          "Signal monitor activated.",
          "Monitor de sinais ativado."
        ),
        emotion: "excited",
        cards: [{ type: "signals", data: { signals } }],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (action === "create_campaign_confirm" && payload?.name) {
      const name = String(payload.name).trim();
      const icebreaker = String(payload.icebreaker || "").trim();
      createLinearCampaignInDb(name, icebreaker);
      const campaigns = getCampaignsList();
      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `🚀 **Campaña "${name}" creada y activada** con pacing seguro (máx. 20 interacciones/día Lun–Vie y Stop on Reply).`,
          `🚀 **Campaign "${name}" created and activated** with safe pacing (max 20 interactions/day Mon–Fri and Stop on Reply).`,
          `🚀 **Campanha "${name}" criada e ativada** com ritmo seguro (máx. 20 interações/dia Seg–Sex e Stop on Reply).`
        ),
        spokenText: t(
          locale,
          `Campaña ${name} creada y activada.`,
          `Campaign ${name} created and activated.`,
          `Campanha ${name} criada e ativada.`
        ),
        emotion: "happy",
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
      const isPostAction = approval.type === "post" && execRes.ok;
      const details = (execRes.details || {}) as Record<string, unknown>;
      const postCardData = isPostAction
        ? {
            id: details.id,
            title: details.title || approval.title || "LinkedIn Post",
            content: details.content || approval.preview,
            status: details.status || (scheduledAt ? "scheduled" : "published"),
            scheduledAt: details.scheduledAt,
            publishedAt: details.publishedAt,
            linkedinPostId: details.linkedinPostId,
            postUrl: details.postUrl,
            targetAccountId: details.accountId,
            format: "text",
            leadMagnetKeyword: "SISTEMA",
            createdAt: new Date().toISOString(),
          }
        : undefined;

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
        cards: postCardData ? [{ type: "post", data: postCardData }] : undefined,
        syncedPost: postCardData,
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    // =========================================================================
    // 1B. APROBACIÓN POR VOZ O TEXTO DE UN BORRADOR PENDIENTE
    // =========================================================================
    const pendingApprovalWrap = payload?.pendingApproval as
      | { messageId?: string; cardIdx?: number; approval?: ApprovalActionPayload }
      | undefined;

    if (
      !imageBase64 &&
      !action &&
      pendingApprovalWrap?.approval &&
      !/^(c[oó]mo|qu[eé]|por qu[eé]|cu[aá]ndo|how |what |why |when |como |o que )/i.test(lower) &&
      /\b(aprueb[ao]|aprobad[oa]|apru[eé]bal[oa]|pub[líi]cal[oa]|m[aá]ndal[oa] a publicar|publicar(lo|la)?|publica(r)? ahora|publica eso|dale adelante|s[ií],?\s*(publica|env[ií]a|aprueba|manda)|est[aá] aprobad[oa]|ag[eé]ndal[oa]|approve|publish( it| now)?|go ahead and publish|aprovad[oa]|pode publicar|publica agora|agende)\b/i.test(
        lower
      )
    ) {
      const wantSchedule = /\b(ag[eé]ndal|program|schedule|agende|ma[ñn]ana|tomorrow|amanh[aã])\b/i.test(lower);
      const pendingApp = pendingApprovalWrap.approval;
      let scheduleIso = pendingApp.scheduledAt;
      if (wantSchedule && !scheduleIso) {
        const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
        scheduleIso = d.toISOString();
      }

      const execRes = await executeApprovedAction(pendingApp, wantSchedule ? scheduleIso : undefined, locale);
      const isPostAction = pendingApp.type === "post" && execRes.ok;
      const details = (execRes.details || {}) as Record<string, unknown>;
      const postCardData = isPostAction
        ? {
            id: details.id,
            title: details.title || pendingApp.title || "LinkedIn Post",
            content: details.content || pendingApp.preview,
            status: details.status || (wantSchedule ? "scheduled" : "published"),
            scheduledAt: details.scheduledAt,
            publishedAt: details.publishedAt,
            linkedinPostId: details.linkedinPostId,
            postUrl: details.postUrl,
            targetAccountId: details.accountId,
            format: "text",
            leadMagnetKeyword: "SISTEMA",
            createdAt: new Date().toISOString(),
          }
        : undefined;

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
          ? t(locale, "Acción aprobada y ejecutada con éxito.", "Action approved and executed.", "Ação aprovada e executada com sucesso.")
          : t(locale, "No se pudo completar la acción.", "Could not complete the action.", "Não foi possível concluir a ação."),
        emotion: execRes.ok ? "happy" : "thinking",
        cards: postCardData ? [{ type: "post", data: postCardData }] : undefined,
        syncedPost: postCardData,
        executedApproval:
          execRes.ok && pendingApprovalWrap.messageId !== undefined
            ? {
                messageId: String(pendingApprovalWrap.messageId),
                cardIdx: Number(pendingApprovalWrap.cardIdx || 0),
                status: wantSchedule ? "scheduled" : "approved",
              }
            : undefined,
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
      (action === "list_signals" ||
        /^(activar |ver |revisar )?(se[ñn]ales( de intenci[oó]n)?|signal radar|activate intent signals|intent signals|ativar sinais( de inten[cç][aã]o)?|sinais de inten[cç][aã]o)[!?.]*$/i.test(
          lower
        ))
    ) {
      const signals = getSignalMonitorsList();
      const activeCount = signals.filter((s) => s.status === "active").length;
      return NextResponse.json({
        ok: true,
        reply:
          signals.length > 0
            ? t(
                locale,
                `Tienes **${signals.length} monitores en Signal Radar** (${activeCount} activos). Puedes activarlos, pausarlos o crear uno nuevo aquí:`,
                `You have **${signals.length} Signal Radar monitors** (${activeCount} active). You can toggle them or activate a new one here:`,
                `Você tem **${signals.length} monitores no Signal Radar** (${activeCount} ativos). Pode ativar, pausar ou criar um novo por aqui:`
              )
            : t(
                locale,
                "Aún no tienes monitores de **Signal Radar** configurados. Activa uno ahora con 1 clic para empezar a capturar prospectos con intención:",
                "You don't have any **Signal Radar** monitors set up yet. Activate one in 1 click to start capturing intent leads:",
                "Você ainda não tem monitores do **Signal Radar** configurados. Ative um agora com 1 clique para começar a capturar leads:"
              ),
        spokenText: t(
          locale,
          signals.length > 0
            ? `Tienes ${activeCount} monitores de señales activos.`
            : "No tienes monitores activos. Puedes activar uno ahora.",
          signals.length > 0
            ? `You have ${activeCount} active signal monitors.`
            : "No active monitors yet. You can activate one right here.",
          signals.length > 0
            ? `Você tem ${activeCount} monitores de sinais ativos.`
            : "Sem monitores ativos. Você pode ativar um agora."
        ),
        emotion: "talking",
        cards: [{ type: "signals", data: { signals } }],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      !isStrategicQuestion &&
      /^(crear (una )?campa[ñn]a( de prospecci[oó]n)?|create (an )?(outreach )?campaign|criar (uma )?campanha( de prospec[cç][aã]o)?)[!?.]*$/i.test(
        lower
      )
    ) {
      const kb = getApprovedKnowledgeContext();
      const company = kb.companyName || "InhubFlow";
      const aiDraft = await callGeminiMultimodal({
        preferFast: true,
        systemPrompt: `Propose a short LinkedIn outreach campaign name and a warm, non-spammy 2-line Icebreaker DM template using {{first_name}}. Write in ${langName}. Return ONLY JSON: {"name": "...", "icebreaker": "..."}`,
        turns: [
          {
            role: "user",
            parts: [{ text: `Company: ${company}\nKnowledge Base:\n${kb.contextText.slice(0, 1200)}` }],
          },
        ],
        temperature: 0.65,
        maxOutputTokens: 500,
        jsonMode: true,
      });

      const parsed = aiDraft.ok ? parseJsonSafe<{ name?: string; icebreaker?: string }>(aiDraft.text) : null;
      const defaultName = t(
        locale,
        `Prospección Signal Radar · ${company}`,
        `Signal Radar Outreach · ${company}`,
        `Prospecção Signal Radar · ${company}`
      );
      const defaultIce = t(
        locale,
        `Hola {{first_name}}, vi tu reciente actividad sobre crecimiento B2B y me encantó tu enfoque. En ${company} ayudamos a equipos a convertir LinkedIn en reuniones calificadas sin spam. ¿Te gustaría intercambiar ideas?`,
        `Hi {{first_name}}, saw your recent LinkedIn activity on B2B growth and loved your take. At ${company} we help teams turn LinkedIn into qualified meetings without spam. Open to connecting?`,
        `Olá {{first_name}}, vi sua atividade recente sobre crescimento B2B e gostei muito da sua abordagem. Na ${company} ajudamos equipes a gerar reuniões qualificadas no LinkedIn sem spam. Vamos trocar uma ideia?`
      );

      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `🚀 Preparé esta propuesta de **Campaña de Prospección Segura** (Visita → Like/Comentar → Conexión → DM → Follow-up, máx. 20 acciones/día). Edita el nombre o mensaje si deseas y confirma:`,
          `🚀 I prepared this **Safe Outreach Campaign** proposal (Visit → Like/Comment → Connect → DM → Follow-up, max 20 actions/day). Edit name or message if needed and confirm:`,
          `🚀 Preparei esta proposta de **Campanha de Prospecção Segura** (Visita → Curtir/Comentar → Conexão → DM → Follow-up, máx. 20 ações/dia). Edite se quiser e confirme:`
        ),
        spokenText: t(
          locale,
          "Preparé una propuesta de campaña de prospección para que la revises y actives.",
          "I prepared an outreach campaign proposal for you to review and activate.",
          "Preparei uma proposta de campanha de prospecção para você revisar e ativar."
        ),
        emotion: "excited",
        cards: [
          {
            type: "campaign_draft",
            data: {
              name: parsed?.name || defaultName,
              icebreaker: parsed?.icebreaker || defaultIce,
            },
          },
        ],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      !isStrategicQuestion &&
      /^(revisar|ver|abrir)? ?(el |o )?(smart )?inbox[!?.]*$/i.test(lower)
    ) {
      const inbox = getInboxOverview();
      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `📥 Resumen de tu **Smart Inbox**: **${inbox.total}** conversaciones registradas, **${inbox.unreadCount}** sin leer y **${inbox.pendingSdrDrafts}** borradores del SDR esperando tu aprobación.`,
          `📥 **Smart Inbox** overview: **${inbox.total}** conversations, **${inbox.unreadCount}** unread, and **${inbox.pendingSdrDrafts}** SDR drafts awaiting your approval.`,
          `📥 Resumo do **Smart Inbox**: **${inbox.total}** conversas, **${inbox.unreadCount}** não lidas e **${inbox.pendingSdrDrafts}** rascunhos do SDR aguardando aprovação.`
        ),
        spokenText: t(
          locale,
          `Tienes ${inbox.unreadCount} conversaciones sin leer y ${inbox.pendingSdrDrafts} borradores SDR pendientes.`,
          `You have ${inbox.unreadCount} unread conversations and ${inbox.pendingSdrDrafts} pending SDR drafts.`,
          `Você tem ${inbox.unreadCount} conversas não lidas e ${inbox.pendingSdrDrafts} rascunhos do SDR pendentes.`
        ),
        emotion: "talking",
        cards: [{ type: "inbox", data: inbox }],
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      !isStrategicQuestion &&
      /^(revisar|ver|abrir)? ?(el |o )?pipeline( crm)?[!?.]*$/i.test(lower) ||
      /^review crm pipeline[!?.]*$/i.test(lower)
    ) {
      const pipeline = getPipelineOverview();
      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `📊 Estado de tu **Pipeline CRM**: tienes **${pipeline.total}** prospectos distribuidos en **${pipeline.stages.length}** etapas activas.`,
          `📊 **CRM Pipeline** status: you have **${pipeline.total}** prospects across **${pipeline.stages.length}** active stages.`,
          `📊 Status do **Pipeline CRM**: você tem **${pipeline.total}** prospects distribuídos em **${pipeline.stages.length}** etapas ativas.`
        ),
        spokenText: t(
          locale,
          `Tu Pipeline CRM tiene ${pipeline.total} prospectos en total.`,
          `Your CRM Pipeline has ${pipeline.total} prospects in total.`,
          `Seu Pipeline CRM tem ${pipeline.total} prospects no total.`
        ),
        emotion: "talking",
        cards: [{ type: "pipeline", data: pipeline }],
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

    // Consultas en vivo sobre publicaciones reales y enlace directo de LinkedIn
    if (
      !imageBase64 &&
      !/\b(crea|crear|genera|escribe|modela|borrador|create|draft|write|criar|escreva)\b/i.test(lower) &&
      /\b(cu[aá]ntos posts|cu[aá]ntas publicaciones|mis posts|mis publicaciones|ver posts|lista de publicaciones|link (de |del )?(la )?(publicaci[oó]n|post)|enlace (de |del )?(la )?(publicaci[oó]n|post)|[uú]ltimo post|ver(lo|la)? en linkedin|how many posts|my posts|post link|latest post|quantos posts|quantas publica[cç][oõ]es|minhas publica[cç][oõ]es|link (da|do) (publica[cç][aã]o|post))\b/i.test(
        lower
      )
    ) {
      const posts = getViralPostsList(12);
      const publishedPosts = posts.filter((p) => p.status === "published");
      const scheduledPosts = posts.filter((p) => p.status === "scheduled");
      const draftPosts = posts.filter((p) => p.status === "draft");

      const latestPublished = publishedPosts[0];
      if (latestPublished && !latestPublished.postUrl) {
        latestPublished.postUrl = await resolveMissingPostUrl(latestPublished);
      }

      const askingForLink = /\b(link|enlace|url|linkedin|ver)\b/i.test(lower);
      let replyText = "";
      if (posts.length === 0) {
        replyText = t(
          locale,
          "Actualmente tienes **0 publicaciones** registradas en tu plataforma.",
          "You currently have **0 posts** recorded in your platform.",
          "Atualmente você tem **0 publicações** registradas na plataforma."
        );
      } else if (askingForLink && latestPublished) {
        replyText = latestPublished.postUrl
          ? t(
              locale,
              `Aquí tienes tu última publicación (**"${latestPublished.title}"**):\n\n🔗 ${latestPublished.postUrl}`,
              `Here is your latest published post (**"${latestPublished.title}"**):\n\n🔗 ${latestPublished.postUrl}`,
              `Aqui está sua última publicação (**"${latestPublished.title}"**):\n\n🔗 ${latestPublished.postUrl}`
            )
          : t(
              locale,
              `Tu última publicación registrada es **"${latestPublished.title}"** (ID: \`${latestPublished.linkedinPostId || latestPublished.id}\`), pero LinkedIn/Unipile aún no devolvió la URL pública directa.`,
              `Your latest recorded post is **"${latestPublished.title}"** (ID: \`${latestPublished.linkedinPostId || latestPublished.id}\`), though LinkedIn/Unipile has not returned a direct public URL yet.`,
              `Sua última publicação registrada é **"${latestPublished.title}"** (ID: \`${latestPublished.linkedinPostId || latestPublished.id}\`), mas o LinkedIn/Unipile ainda não retornou a URL pública direta.`
            );
      } else {
        replyText = t(
          locale,
          `Tienes **${posts.length} publicaciones** en tu plataforma: **${publishedPosts.length}** publicadas, **${scheduledPosts.length}** programadas y **${draftPosts.length}** borradores.${latestPublished?.postUrl ? `\n\n🔗 Última publicada: ${latestPublished.postUrl}` : ""}`,
          `You have **${posts.length} posts** in your platform: **${publishedPosts.length}** published, **${scheduledPosts.length}** scheduled, and **${draftPosts.length}** drafts.${latestPublished?.postUrl ? `\n\n🔗 Latest published: ${latestPublished.postUrl}` : ""}`,
          `Você tem **${posts.length} publicações** na plataforma: **${publishedPosts.length}** publicadas, **${scheduledPosts.length}** agendadas e **${draftPosts.length}** rascunhos.${latestPublished?.postUrl ? `\n\n🔗 Última publicada: ${latestPublished.postUrl}` : ""}`
        );
      }

      return NextResponse.json({
        ok: true,
        reply: replyText,
        spokenText: t(
          locale,
          `Tienes ${posts.length} publicaciones registradas: ${publishedPosts.length} publicadas y ${scheduledPosts.length} programadas.`,
          `You have ${posts.length} posts recorded: ${publishedPosts.length} published and ${scheduledPosts.length} scheduled.`,
          `Você tem ${posts.length} publicações registradas: ${publishedPosts.length} publicadas e ${scheduledPosts.length} agendadas.`
        ),
        emotion: "talking",
        cards: posts.slice(0, 5).map((p) => ({ type: "post" as const, data: p })),
        quickActions: ui.quickActions,
      } as BotCommandResponse);
    }

    // Pregunta directa sobre qué página / pantalla del Dashboard tiene abierta el usuario ahora mismo
    if (
      !imageBase64 &&
      /\b(en qu[eé] p[aá]gina estoy|en qu[eé] pantalla estoy|d[oó]nde estoy|sabes en qu[eé] p[aá]gina|sabes d[oó]nde estoy|qu[eé] p[aá]gina tengo abierta|what page am i on|where am i|which page|em que p[aá]gina estou|em qual tela estou|onde estou)\b/i.test(
        lower
      )
    ) {
      const { presence, ageSeconds, ageLabel } = getDashboardPresence(dashboardUserId);
      if (!presence) {
        return NextResponse.json({
          ok: true,
          reply: t(
            locale,
            "Todavía no detecto ninguna pestaña del **Dashboard** abierta o activa recientemente. Abre o navega en cualquier página de tu Dashboard (por ejemplo *Cuentas de LinkedIn*) y volveré a verla al instante.",
            "I don't detect an active **Dashboard** tab yet. Open or navigate to any page in your Dashboard (such as *LinkedIn Accounts*) and I will track it immediately.",
            "Ainda não detectei nenhuma aba do **Dashboard** ativa recentemente. Abra ou navegue em qualquer página do Dashboard e eu a detectarei na hora."
          ),
          spokenText: t(
            locale,
            "Aún no detecto ninguna pestaña activa del Dashboard.",
            "I don't detect an active Dashboard tab yet.",
            "Ainda não detectei uma aba ativa do Dashboard."
          ),
          emotion: "thinking",
          quickActions: ui.quickActions,
        } as BotCommandResponse);
      }

      const isLive = ageSeconds !== null && ageSeconds <= 180;
      const snap = getPlatformSummary();
      const contextCards: BotActionCard[] = [];
      if (presence.moduleKey === "accounts") {
        contextCards.push({ type: "accounts", data: snap.accounts });
      } else if (presence.moduleKey.startsWith("signals")) {
        contextCards.push({ type: "signals", data: { signals: getSignalMonitorsList() } });
      } else if (presence.moduleKey === "campaigns") {
        contextCards.push({ type: "campaigns", data: { campaigns: getCampaignsList() } });
      } else if (presence.moduleKey === "inbox") {
        contextCards.push({ type: "inbox", data: getInboxOverview() });
      } else if (presence.moduleKey === "pipeline") {
        contextCards.push({ type: "pipeline", data: getPipelineOverview() });
      }

      return NextResponse.json({
        ok: true,
        reply: t(
          locale,
          `📍 Estás en **${presence.moduleLabel}** (\`${presence.fullPath}\`)${ageLabel ? ` · ${isLive ? "🟢 En vivo" : "Última vista"} hace ${ageLabel}` : ""}.\n\n${presence.moduleDescription}`,
          `📍 You are currently on **${presence.moduleLabel}** (\`${presence.fullPath}\`)${ageLabel ? ` · ${isLive ? "🟢 Live" : "Last seen"} ${ageLabel} ago` : ""}.\n\n${presence.moduleDescription}`,
          `📍 Você está em **${presence.moduleLabel}** (\`${presence.fullPath}\`)${ageLabel ? ` · ${isLive ? "🟢 Ao vivo" : "Último acesso"} há ${ageLabel}` : ""}.\n\n${presence.moduleDescription}`
        ),
        spokenText: t(
          locale,
          `Estás en ${presence.moduleLabel}.`,
          `You are on ${presence.moduleLabel}.`,
          `Você está em ${presence.moduleLabel}.`
        ),
        emotion: "talking",
        cards: contextCards.length > 0 ? contextCards : undefined,
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
    // 5. CONVERSACIÓN GENERAL / ESTRATEGIA CON GEMINI + CONOCIMIENTO TOTAL EN VIVO
    // =========================================================================
    const snap = getPlatformSummary();
    const campaignsList = getCampaignsList();
    const topLeads = getRecentLeads();
    const postsList = getViralPostsList(12);
    const signalsList = getSignalMonitorsList();
    const inboxOverview = getInboxOverview();
    const pipelineOverview = getPipelineOverview();
    const activeAccount = await resolveActiveLinkedInAccount();
    const accountDetails = await getLinkedInAccountsDetails();
    const { presence, ageSeconds, ageLabel } = getDashboardPresence(dashboardUserId);
    const turns = buildHistoryTurns(history);
    turns.push({ role: "user", parts: [{ text: message || "Hello" }] });

    const postsTotal = postsList.length;
    const presenceLine = presence
      ? `- PANTALLA ACTUAL DEL USUARIO EN EL DASHBOARD (${ageSeconds !== null && ageSeconds <= 180 ? "EN VIVO" : "RECIENTE"}, hace ${ageLabel || "poco"}): "${presence.moduleLabel}" | ruta=${presence.fullPath} | clave=${presence.moduleKey} | contexto=${presence.moduleDescription}`
      : "- PANTALLA ACTUAL DEL USUARIO EN EL DASHBOARD: Aún sin actividad reciente detectada en otra pestaña.";

    const liveWorkspaceSummary = [
      presenceLine,
      `- Cuenta LinkedIn principal en vivo: ${activeAccount.accountId ? `${activeAccount.accountName} (ACTIVA / ${activeAccount.accountId})` : "Ninguna cuenta activa"} | Total registradas: ${snap.accounts.active}/${snap.accounts.total}`,
      accountDetails.length > 0
        ? `  Detalle cuentas LinkedIn: ${accountDetails.map((a) => `${a.name} [status=${a.status}${a.email ? `, ${a.email}` : ""}]`).join(" | ")}`
        : "",
      `- Publicaciones en Dashboard (viral_posts total=${postsTotal}: ${snap.posts.published} publicadas, ${snap.posts.scheduled} programadas, ${snap.posts.draft} borradores):`,
      ...postsList.map(
        (p, idx) =>
          `  ${idx + 1}. [${p.status.toUpperCase()}] "${p.title}" | fecha=${p.publishedAt || p.scheduledAt || p.createdAt || "N/A"}${p.postUrl ? ` | link=${p.postUrl}` : p.linkedinPostId ? ` | linkedinId=${p.linkedinPostId}` : ""}`
      ),
      `- Prospectos CRM: ${snap.leads.total} (${snap.leads.qualified} con alta intención >= 80 pts)`,
      pipelineOverview.stages.length > 0
        ? `  Etapas Pipeline: ${pipelineOverview.stages.map((s) => `${s.stage}=${s.count}`).join(", ")}`
        : "",
      topLeads.length > 0
        ? `  Últimos leads: ${topLeads.map((l) => `${l.name} (${l.headline}, ${l.score} pts, etapa ${l.stage}, ${l.profileUrl})`).join(" | ")}`
        : "",
      `- Campañas Lineales: ${snap.campaigns.active}/${snap.campaigns.total} activas`,
      campaignsList.length > 0
        ? `  Detalle campañas: ${campaignsList.map((c) => `${c.name} [${c.code}, ${c.status}, ${c.leadsCount} leads]`).join(" | ")}`
        : "",
      `- Monitores Signal Radar: ${snap.signals.active}/${snap.signals.total} activos`,
      signalsList.length > 0
        ? `  Monitores: ${signalsList.map((s) => `${s.title} [${s.level}, ${s.status}, ${s.leadsCount} leads]`).join(" | ")}`
        : "",
      `- Smart Inbox: ${inboxOverview.total} conversaciones (${inboxOverview.unreadCount} sin leer), ${inboxOverview.pendingSdrDrafts} borradores SDR pendientes`,
      inboxOverview.conversations.length > 0
        ? `  Últimos chats: ${inboxOverview.conversations.map((c) => `${c.leadName} (${c.stage}, unread=${c.unread})`).join(" | ")}`
        : "",
      `- Pacing hoy: ${snap.pacingToday.invites} invitaciones, ${snap.pacingToday.dms} DMs`,
    ]
      .filter(Boolean)
      .join("\n");

    const ownerFirstName = activeAccount.accountName
      ? activeAccount.accountName.trim().split(/\s+/)[0]
      : "";
    const linkedinConnectionStatus = activeAccount.accountId
      ? `CONNECTED & ACTIVE (${activeAccount.accountName})`
      : "DISCONNECTED (no active LinkedIn account)";

    const aiReply = await callGeminiMultimodal({
      systemPrompt: `You are "InhubBot", InhubFlow's intelligent AI partner & mobile Social Selling Assistant.
CRITICAL: Always reply strictly in ${langName} (${locale}). Be insightful, strategic, clear, practical, and easy to read on a mobile screen.

USER & CONNECTION CONTEXT:
- User's first name: ${ownerFirstName || "(unknown)"}
- LinkedIn account connection status: ${linkedinConnectionStatus}

YOUR PERSONA:
- You have a warm, human, natural tone — like a trusted business partner talking face-to-face, NEVER like a stiff WhatsApp autoresponder or a corporate bot.
- CRITICAL GREETING RULE: When the user simply greets you ("hola", "buenos días", "bom dia", "good morning", "oi", "hey", etc.) WITHOUT asking for a report, summary, or specific task:
  - DO NOT give an unsolicited report, metrics, campaign counts, inbox counts, or lists of suggestions. People hate unsolicited reports!
  - Perform ONLY ONE quick check: the LinkedIn account connection status above.
  - Reply in 1–2 short, warm sentences using the user's first name (if known), stating whether their LinkedIn account is connected and active (or disconnected), and asking how you can help.
  - Example if connected (es): "¡Hola ${ownerFirstName || "Roberto"}! ¿Cómo estás hoy? Tu cuenta está conectada y activa, ¿puedo ayudarte con algo?"
  - Example if connected (pt-BR): "Oi ${ownerFirstName || "Roberto"}, tudo bem hoje? Sua conta está conectada e ativa, posso ajudar com alguma coisa?"
  - Example if connected (en): "Hey ${ownerFirstName || "there"}! How are you doing today? Your LinkedIn account is connected and active — can I help you with anything?"
  - Example if disconnected: greet warmly by name and briefly mention their LinkedIn account isn't connected right now, asking if they want help with that or something else.
- Keep casual replies short (1–3 sentences). Only give detailed reports, metrics, or action lists when the user explicitly asks for them.
- Use natural transitions: "¡Claro!", "¡Genial!", "Vamos a eso", "Por supuesto" — never stiff corporate language.

YOUR ROLE:
You are NOT a generic chatbot. You are:
1. A deep expert on **every single module, rule, limit, and workflow inside InhubFlow Social Selling Suite**.
2. A senior **LinkedIn, Personal Branding, Copywriting & B2B Social Selling strategist** who thinks critically, gives actionable advice, diagnoses bottlenecks, rewrites hooks/profiles, and proposes concrete next steps.
3. A hands-free mobile operator with Human-in-the-Loop protection connected to the user's real platform database and LinkedIn account.

GOLDEN RULES (NON-NEGOTIABLE):
- NEVER fabricate, guess, or inflate live metrics, post counts, links, or lead names. Use ONLY the exact numbers, titles, statuses, and URLs in LIVE WORKSPACE SNAPSHOT below.
- NEVER claim that you have just published a post, sent a message, or scheduled something unless the action actually executed via the approval flow. If a user wants to publish a draft and it hasn't been triggered, tell them clearly to tap "Publish now" on the approval card or say "Aprueba y publica ahora".
- If a post has a real link in LIVE WORKSPACE SNAPSHOT, share the exact URL; if it does not have a URL yet, state honestly that LinkedIn did not return a public link yet.

${INHUBFLOW_MASTER_KNOWLEDGE}

=== LIVE WORKSPACE SNAPSHOT (REAL DATABASE & LINKEDIN STATE) ===
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
