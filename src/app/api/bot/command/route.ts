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
        headline: String(meta.headline || meta.title || "Tomador de decisión B2B"),
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
  kbContext: string
): Promise<ClassifiedIntent> {
  const nowIso = new Date().toISOString();
  const res = await callGeminiMultimodal({
    systemPrompt: `Eres el clasificador de intenciones de InhubBot (Social Selling en LinkedIn).
Fecha/hora actual UTC: ${nowIso}.

Analiza el mensaje del usuario y clasifícalo en UNA de estas 3 intenciones:
1. "person_outreach": El usuario pide buscar, contactar, enviar mensaje/propuesta/video, pedir conexión o comentar el post de UNA PERSONA específica (ej: "busca a Juan Pérez de TechCorp", "comenta la última publicación de Carlos", "mándale una propuesta a Ana de Acme", "pide conexión a Luis").
2. "create_viral_post": El usuario pide crear, redactar, modelar, buscar posts virales para inspirarse o publicar/agendar un post de LinkedIn (ej: "busca los mejores posts sobre IA en México y crea un post", "crea un post sobre social selling", "publica algo sobre ventas B2B").
3. "general_chat": Pregunta estratégica, seguimiento de conversación, consulta sobre la empresa o cualquier otra cosa.

Contexto de empresa (referencia): ${kbContext.slice(0, 600)}

Devuelve EXCLUSIVAMENTE JSON válido:
{
  "intent": "person_outreach" | "create_viral_post" | "general_chat",
  "personQuery": "Nombre Empresa (si aplica)",
  "intendedAction": "message" | "connection" | "comment" | "proposal" | "auto",
  "userContext": "instrucciones/evento/recurso pedido por el usuario",
  "topic": "tema del post (si aplica)",
  "searchViralFirst": true o false,
  "scheduledDateIso": "ISO string si el usuario pidió fecha/hora específica, o null"
}`,
    turns: [{ role: "user", parts: [{ text: message }] }],
    temperature: 0.1,
    maxOutputTokens: 350,
    jsonMode: true,
  });

  if (res.ok && res.text) {
    const parsed = parseJsonSafe<ClassifiedIntent>(res.text);
    if (parsed?.intent) return parsed;
  }

  // Fallback heurístico si Gemini no respondió JSON
  const lower = message.toLowerCase();
  if (
    /\b(busca a|contacta a|conecta con|solicitud de conexi[oó]n|m[aá]ndale|env[ií]ale|comenta.*publicaci[oó]n de|comenta.*post de|escr[ií]bele a|linkedin\.com\/in\/)\b/i.test(
      lower
    )
  ) {
    const isComment = /comenta/i.test(lower);
    const isConnect = /conexi[oó]n|conecta/i.test(lower);
    const isProp = /propuesta|video|recurso/i.test(lower);
    const cleanPerson = message
      .replace(
        /\b(por favor|inhub|inhubbot|quiero que|busca a|contacta a|conecta con|m[aá]ndale|env[ií]ale|comenta la [uú]ltima publicaci[oó]n de|comenta el [uú]ltimo post de|una propuesta|un mensaje|solicitud de conexi[oó]n)\b/gi,
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
    /\b(crear post|crea un post|nuevo post|escribe un post|modela|publicar|mejores posts|posts virales|carrusel)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "create_viral_post",
      topic: message,
      searchViralFirst: /mejores|virales|busca/i.test(lower),
    };
  }

  return { intent: "general_chat" };
}

async function generatePostApprovalData(params: {
  topicOrInstruction: string;
  kbContext: string;
  companyName: string | null;
  referencePostsText?: string;
  imageBase64?: string;
  imageMimeType?: string;
  scheduledAt?: string;
}): Promise<{ title: string; content: string; summaryNote: string }> {
  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

  if (params.imageBase64 && params.imageMimeType) {
    parts.push({
      inline_data: {
        mime_type: params.imageMimeType,
        data: params.imageBase64,
      },
    });
  }

  const promptText = [
    params.imageBase64
      ? "El usuario adjuntó esta IMAGEN (ej. foto de un artículo de revista, captura o gráfico). Analiza todo el texto, idea central y enfoque visual de la imagen."
      : "",
    `Instrucción del usuario: "${params.topicOrInstruction || "Modela este contenido en un post de autoridad para nuestra empresa."}"`,
    params.referencePostsText
      ? `\nPosts virales reales encontrados en LinkedIn para modelar estructura y gancho:\n${params.referencePostsText}`
      : "",
    `\nBase de Conocimiento de la empresa (${params.companyName || "InhubFlow"}):\n${params.kbContext}`,
    `\nResponde EXCLUSIVAMENTE en JSON válido con:
{
  "title": "Título corto descriptivo (máx 55 caracteres)",
  "summaryNote": "1 frase explicando qué modelaste (ej. del artículo de la foto o de los posts virales encontrados)",
  "content": "Texto completo del post listo para LinkedIn con gancho fuerte en las primeras 2 líneas, párrafos escaneables, propuesta de valor alineada a la empresa y CTA final"
}`,
  ]
    .filter(Boolean)
    .join("\n");

  parts.push({ text: promptText });

  const ai = await callGeminiMultimodal({
    systemPrompt:
      "Eres un experto en Social Selling y Copywriting B2B en LinkedIn. Tu trabajo es redactar publicaciones de alta autoridad listas para que el humano apruebe antes de publicar. Responde en español.",
    turns: [{ role: "user", parts }],
    temperature: 0.7,
    maxOutputTokens: 1200,
    jsonMode: true,
  });

  if (ai.ok && ai.text) {
    const parsed = parseJsonSafe<{ title?: string; content?: string; summaryNote?: string }>(ai.text);
    if (parsed?.content) {
      return {
        title: parsed.title || "Post modelado para LinkedIn",
        content: parsed.content,
        summaryNote: parsed.summaryNote || "Borrador optimizado con tu Base de Conocimiento.",
      };
    }
  }

  const cleanTopic = params.topicOrInstruction.slice(0, 70) || "Social Selling B2B";
  return {
    title: `Insights sobre ${cleanTopic}`,
    summaryNote: "Borrador preparado listo para tu revisión.",
    content: [
      `La mayoría en ${cleanTopic} sigue enfocándose en volumen frío en lugar de relevancia real.\n`,
      `Cuando combinas señales de intención con contenido de autoridad, cada conversación empieza con contexto y confianza.\n`,
      `3 claves que aplicamos hoy:\n1. Diagnóstico claro del problema del cliente.\n2. Contenido práctico que demuestra cómo resolverlo.\n3. Seguimiento humano sin mensajes robotizados.\n`,
      `¿Cómo lo están abordando en tu equipo? Te leo en comentarios.`,
    ].join("\n"),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const message = String(body.message || "").trim();
    const action = String(body.action || "").trim();
    const payload = (body.payload || {}) as Record<string, unknown>;
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : undefined;
    const imageMimeType = typeof body.imageMimeType === "string" ? body.imageMimeType : undefined;
    const history = Array.isArray(body.history) ? (body.history as HistoryItem[]) : [];
    const lower = message.toLowerCase();

    // =========================================================================
    // 1. ACCIONES EXPLÍCITAS DESDE TARJETAS (HUMAN-IN-THE-LOOP)
    // =========================================================================

    // 1A. Pausar / Activar Campaña
    if (action === "toggle_campaign" && payload?.campaignId && payload?.status) {
      const ok = toggleCampaignStatus(
        String(payload.campaignId),
        payload.status === "active" ? "active" : "paused"
      );
      const campaigns = getCampaignsList();
      const statusText = payload.status === "active" ? "activada" : "pausada";
      return NextResponse.json({
        ok,
        reply: `Listo. La campaña **${String(payload.campaignName || payload.campaignId)}** ha sido **${statusText}** con éxito.`,
        spokenText: `Campaña ${statusText} correctamente.`,
        emotion: "talking",
        cards: [{ type: "campaigns", data: { campaigns } }],
        quickActions: ["Dame el resumen de hoy", "Crear post viral", "Últimos prospectos del radar"],
      } as BotCommandResponse);
    }

    // 1B. Confirmación de Identidad ("✅ Sí, es él") → Detecta grado de conexión y propone acción
    if (action === "confirm_profile" && payload?.person) {
      const person = payload.person as VerifiedPersonCandidate;
      const intendedAction = String(payload.intendedAction || "auto");
      const userContext = String(payload.userContext || "");
      const kb = getApprovedKnowledgeContext();
      const { accountId } = await resolveActiveLinkedInAccount();

      const isFirstDegree = person.networkDistance === "FIRST_DEGREE";
      const distLabel =
        person.networkDistance === "FIRST_DEGREE"
          ? "1er nivel (ya conectados)"
          : person.networkDistance === "SECOND_DEGREE"
            ? "2do nivel"
            : person.networkDistance === "THIRD_DEGREE"
              ? "3er nivel"
              : "fuera de tu red directa";

      // Caso: comentar la última publicación del perfil
      if (intendedAction === "comment") {
        const identifier = person.publicIdentifier || person.providerId;
        const latestPost = accountId ? await getLatestPostOfPerson(identifier, accountId) : null;

        if (!latestPost) {
          return NextResponse.json({
            ok: true,
            reply: `Confirmado: **${person.name}**. Sin embargo, no encontré publicaciones públicas recientes en su perfil para comentar.\n\n¿Quieres que le enviemos ${
              isFirstDegree ? "un mensaje directo" : "una solicitud de conexión"
            } en su lugar?`,
            spokenText: `No encontré publicaciones recientes de ${person.name}.`,
            emotion: "thinking",
            quickActions: [
              isFirstDegree
                ? `Envíale un mensaje a ${person.name}`
                : `Envíale solicitud de conexión a ${person.name}`,
              "Dame el resumen de hoy",
            ],
          } as BotCommandResponse);
        }

        const postText = String(latestPost.text || latestPost.content || "").slice(0, 900);
        const aiComment = await callGeminiMultimodal({
          systemPrompt:
            "Redacta un comentario breve, genuino y de alto valor en LinkedIn (máx 2-3 frases) para la publicación de un prospecto. Sin sonar a spam ni vender agresivamente. Usa contexto de la empresa solo si aporta. Responde SOLO con el texto del comentario.",
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `Prospecto: ${person.name} (${person.headline})\nPublicación suya:\n"${postText}"\nInstrucción extra del usuario: ${userContext || "Ninguna"}\nContexto empresa: ${kb.contextText.slice(0, 800)}`,
                },
              ],
            },
          ],
          temperature: 0.7,
          maxOutputTokens: 250,
        });

        const draftComment =
          aiComment.ok && aiComment.text
            ? aiComment.text
            : `Muy buen punto, ${person.name.split(" ")[0]}. Coincido totalmente con esa visión; en nuestro día a día vemos exactamente el mismo impacto cuando se ejecuta con foco.`;

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
          reply: `Perfecto, encontré la última publicación de **${person.name}**.\n\nAquí tienes mi propuesta de comentario. Revísala y apruébala antes de publicarla:`,
          spokenText: `Preparé un comentario para la última publicación de ${person.name}. Revísalo para aprobarlo.`,
          emotion: "talking",
          cards: [{ type: "approval", data: { approval } }],
        } as BotCommandResponse);
      }

      // Caso: Mensaje / Propuesta / Conexión según nivel de conexión
      if (isFirstDegree) {
        const aiMsg = await callGeminiMultimodal({
          systemPrompt: `Eres Inhub, el asistente SDR de ${kb.companyName || "InhubFlow"}. Redacta un mensaje directo personalizado en LinkedIn para un contacto de 1er grado. Integra de forma natural cualquier detalle de evento, propuesta o recurso (video/link) que exista en la Base de Conocimiento si el usuario lo pidió. Responde SOLO con el texto del mensaje.`,
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `Destinatario: ${person.name} (${person.headline})\nInstrucción del usuario: ${userContext || "Salúdalo y preséntale nuestra propuesta"}\nBase de Conocimiento:\n${kb.contextText}`,
                },
              ],
            },
          ],
          temperature: 0.7,
          maxOutputTokens: 450,
        });

        const draftMsg =
          aiMsg.ok && aiMsg.text
            ? aiMsg.text
            : `Hola ${person.name.split(" ")[0]}, un gusto saludarte. ${
                userContext ? `Sobre lo que comentamos (${userContext}), ` : ""
              }me encantaría compartirte cómo ayudamos a equipos como el tuyo a generar reuniones calificadas en LinkedIn. ¿Te parece si conversamos 15 minutos esta semana?`;

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
          reply: `Confirmado: **${person.name}** está en tu **${distLabel}** ✅.\n\nComo ya están conectados, preparé este **mensaje directo** con tu contexto y Base de Conocimiento. Aprueba o edita antes de enviarlo:`,
          spokenText: `${person.name} ya es contacto de primer grado. Preparé el mensaje directo para tu aprobación.`,
          emotion: "excited",
          cards: [{ type: "approval", data: { approval } }],
        } as BotCommandResponse);
      } else {
        // 2do / 3er grado → primero solicitud de conexión (máx 300 caracteres)
        const aiInvite = await callGeminiMultimodal({
          systemPrompt: `Redacta una nota breve para solicitud de conexión en LinkedIn (ESTRICTAMENTE máximo 260 caracteres). Cercana, humana y mencionando el contexto/evento si existe. Responde SOLO con el texto de la nota.`,
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `Destinatario: ${person.name} (${person.headline})\nContexto del usuario: ${userContext || "Conectar profesionalmente"}`,
                },
              ],
            },
          ],
          temperature: 0.7,
          maxOutputTokens: 140,
        });

        const draftInvite = (
          aiInvite.ok && aiInvite.text
            ? aiInvite.text
            : `Hola ${person.name.split(" ")[0]}, qué gusto encontrarte por aquí. Me encantaría conectar contigo en LinkedIn y mantener el contacto.`
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
            ? `\n\n*(Nota: Como aún no son 1er grado, primero enviaremos la solicitud de conexión y, apenas acepte, podrás enviarle la propuesta completa).*`
            : "";

        return NextResponse.json({
          ok: true,
          reply: `Confirmado: **${person.name}** está en tu **${distLabel}**.${extraHint}\n\nPreparé esta **solicitud de conexión** para que la apruebes:`,
          spokenText: `${person.name} está en ${distLabel}. Preparé la solicitud de conexión para tu aprobación.`,
          emotion: "talking",
          cards: [{ type: "approval", data: { approval } }],
        } as BotCommandResponse);
      }
    }

    // 1C. Rechazar candidato ("❌ No es él")
    if (action === "reject_profile") {
      const remaining = Array.isArray(payload.remaining)
        ? (payload.remaining as VerifiedPersonCandidate[])
        : [];
      if (remaining.length > 0) {
        return NextResponse.json({
          ok: true,
          reply: `Entendido, descartado. Aquí tienes la siguiente coincidencia encontrada en LinkedIn. **¿Es esta la persona?**`,
          spokenText: `Te muestro la siguiente coincidencia para confirmar.`,
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
        reply: `De acuerdo, no actuaré sobre ese perfil. Por favor dime el **nombre completo + empresa**, ciudad o pega su **URL de LinkedIn** para buscar exactamente a la persona correcta.`,
        spokenText: `De acuerdo. Dime su empresa o URL de LinkedIn para buscar de nuevo.`,
        emotion: "idle",
      } as BotCommandResponse);
    }

    // 1D. Aprobar o Agendar Acción Real ("✅ Aprobar" / "📅 Agendar")
    if ((action === "approve_action" || action === "schedule_action") && payload?.approval) {
      const approval = payload.approval as ApprovalActionPayload;
      const scheduledAt =
        action === "schedule_action" && payload.scheduledAt
          ? String(payload.scheduledAt)
          : undefined;

      const execRes = await executeApprovedAction(approval, scheduledAt);
      return NextResponse.json({
        ok: execRes.ok,
        reply: execRes.ok
          ? `✅ **Listo.** ${execRes.message}`
          : `⚠️ No pude completar la acción: ${execRes.message}`,
        spokenText: execRes.ok ? "Acción ejecutada con éxito." : "No se pudo completar la acción.",
        emotion: execRes.ok ? "happy" : "thinking",
        quickActions: ["Dame el resumen de hoy", "Crear post viral", "¿Cómo van las campañas?"],
      } as BotCommandResponse);
    }

    // 1E. Descartar Borrador ("🗑️ Descartar")
    if (action === "discard_action") {
      return NextResponse.json({
        ok: true,
        reply: "🗑️ **Acción descartada.** No se publicó ni se envió nada en tu cuenta de LinkedIn.",
        spokenText: "Acción descartada.",
        emotion: "idle",
        quickActions: ["Crear post viral", "Dame el resumen de hoy", "¿Cómo van las campañas?"],
      } as BotCommandResponse);
    }

    // =========================================================================
    // 2. FAST-PATH DETERMINÍSTICO PARA MÉTRICAS, CAMPAÑAS, LEADS Y CUENTAS
    // =========================================================================

    if (
      !imageBase64 &&
      (action === "get_summary" ||
        /^(dame el )?(resumen|reporte|m[eé]tricas|estad[ií]sticas|balance|panel|stats)/i.test(lower) ||
        /\b(resumen de hoy|resumen del d[ií]a|estado general)\b/i.test(lower))
    ) {
      const snap = getPlatformSummary();
      const accountsOk = snap.accounts.active > 0;
      const reply = [
        `Aquí tienes el **resumen ejecutivo** de tu plataforma InhubFlow:`,
        `\n* **Cuentas de LinkedIn:** ${snap.accounts.active} activas (${snap.accounts.total} registradas).`,
        `* **Prospectos en CRM:** ${snap.leads.total} captados (${snap.leads.qualified} con alta intención comercial).`,
        `* **Campañas de Secuencia:** ${snap.campaigns.active} activas de ${snap.campaigns.total} totales.`,
        `* **Publicaciones:** ${snap.posts.published} publicadas, ${snap.posts.scheduled} programadas y ${snap.posts.draft} en borrador.`,
        `* **Signal Radar:** ${snap.signals.active} monitores escaneando activamente.`,
        `* **Actividad de Hoy:** ${snap.pacingToday.invites} invitaciones y ${snap.pacingToday.dms} mensajes enviados bajo ritmo seguro.`,
        `\n${accountsOk ? "¿Qué acción estratégica deseas ejecutar ahora?" : "Recuerda conectar una cuenta de LinkedIn para operar en vivo."}`,
      ].join("\n");

      return NextResponse.json({
        ok: true,
        reply,
        spokenText: `Tienes ${snap.leads.total} prospectos en CRM y ${snap.campaigns.active} campañas activas.`,
        emotion: "talking",
        cards: [{ type: "summary", data: snap }],
        quickActions: ["¿Cómo van las campañas?", "Crear post viral", "Últimos prospectos del radar"],
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      (action === "list_campaigns" ||
        /\b(c[oó]mo van las campa[ñn]as|ver campa[ñn]as|estado de campa[ñn]as|mis campa[ñn]as|secuencias lineales)\b/i.test(
          lower
        ))
    ) {
      const campaigns = getCampaignsList();
      const activeCount = campaigns.filter((c) => c.status === "active").length;
      return NextResponse.json({
        ok: true,
        reply:
          campaigns.length > 0
            ? `Tienes **${campaigns.length} campañas configuradas** (${activeCount} activas). Puedes pausar o activar cualquiera directamente desde aquí:`
            : `Aún no tienes campañas lineales creadas en tu dashboard.`,
        spokenText: `Tienes ${activeCount} campañas activas de ${campaigns.length}.`,
        emotion: "talking",
        cards: campaigns.length > 0 ? [{ type: "campaigns", data: { campaigns } }] : [],
        quickActions: ["Crear post viral", "Dame el resumen de hoy", "Últimos prospectos del radar"],
      } as BotCommandResponse);
    }

    if (
      !imageBase64 &&
      /\b([uú]ltimos prospectos|prospectos del radar|ver prospectos|leads del radar|qui[eé]n interactu[oó])\b/i.test(
        lower
      )
    ) {
      const leads = getRecentLeads();
      return NextResponse.json({
        ok: true,
        reply:
          leads.length > 0
            ? `Aquí tienes los **últimos prospectos con alta intención** captados por Signal Radar y secuencias:`
            : `Aún no hay prospectos registrados en tu CRM.`,
        spokenText:
          leads.length > 0
            ? `Se han detectado ${leads.length} prospectos clave en el CRM.`
            : `Sin nuevos prospectos por el momento.`,
        emotion: "talking",
        cards: leads.length > 0 ? [{ type: "leads", data: { leads } }] : [],
        quickActions: ["Dame el resumen de hoy", "Crear post viral", "¿Cómo van las campañas?"],
      } as BotCommandResponse);
    }

    if (!imageBase64 && /\b(estado de mi cuenta|estado de cuentas|cuenta de linkedin)\b/i.test(lower)) {
      const snap = getPlatformSummary();
      const isConnected = snap.accounts.active > 0;
      return NextResponse.json({
        ok: true,
        reply: isConnected
          ? `Tu cuenta de LinkedIn está **conectada y operativa**, respetando el pacing diario seguro de lunes a viernes.`
          : `No tienes ninguna cuenta de LinkedIn activa en este momento. Conéctala en **Cuentas de LinkedIn** del dashboard.`,
        spokenText: isConnected
          ? `Tu cuenta de LinkedIn está conectada y protegida.`
          : `Conecta tu cuenta de LinkedIn para comenzar.`,
        emotion: isConnected ? "talking" : "thinking",
        cards: [{ type: "accounts", data: snap.accounts }],
        quickActions: ["Dame el resumen de hoy", "Crear post viral", "¿Cómo van las campañas?"],
      } as BotCommandResponse);
    }

    // =========================================================================
    // 3. FLUJO MULTIMODAL CON FOTO / IMAGEN (Revista, Artículo, Captura → Post)
    // =========================================================================
    const kb = getApprovedKnowledgeContext();

    if (imageBase64 && imageMimeType) {
      const modeled = await generatePostApprovalData({
        topicOrInstruction:
          message ||
          "Analiza el artículo o contenido de esta foto y modélalo en un post de autoridad para nuestra empresa.",
        kbContext: kb.contextText,
        companyName: kb.companyName,
        imageBase64,
        imageMimeType,
      });

      const approval: ApprovalActionPayload = {
        type: "post",
        title: modeled.title,
        preview: modeled.content,
      };

      return NextResponse.json({
        ok: true,
        reply: `📸 **Analicé tu imagen** y modelé una publicación alineada a **${
          kb.companyName || "tu empresa"
        }**.\n\n*${modeled.summaryNote}*\n\nComo regla de oro, **nunca publico solo**: revisa, edita, agenda o aprueba aquí:`,
        spokenText: `Analicé la imagen y preparé el borrador del post. Revísalo para aprobarlo o agendarlo.`,
        emotion: "excited",
        cards: [{ type: "approval", data: { approval } }],
      } as BotCommandResponse);
    }

    // =========================================================================
    // 4. ENRUTAMIENTO INTELIGENTE CON GEMINI (Personas, Posts Virales o Chat)
    // =========================================================================
    const classified = await classifyBotIntent(message, kb.contextText);

    // 4A. Búsqueda y Verificación de Persona (Foto + Grado de Conexión)
    if (classified.intent === "person_outreach" && classified.personQuery) {
      const searchRes = await searchLinkedInPeopleForVerification(classified.personQuery);

      if (!searchRes.ok && searchRes.error) {
        return NextResponse.json({
          ok: true,
          reply: `⚠️ ${searchRes.error} Conecta tu perfil desde el dashboard para buscar personas en LinkedIn en tiempo real.`,
          spokenText: searchRes.error,
          emotion: "thinking",
        } as BotCommandResponse);
      }

      if (searchRes.candidates.length === 0) {
        return NextResponse.json({
          ok: true,
          reply: `No encontré coincidencias claras para **"${classified.personQuery}"** en LinkedIn.\n\nIntenta darme su **nombre completo + empresa**, o pega directamente la **URL de su perfil de LinkedIn**.`,
          spokenText: `No encontré coincidencias para ${classified.personQuery}.`,
          emotion: "thinking",
        } as BotCommandResponse);
      }

      return NextResponse.json({
        ok: true,
        reply: `🔎 Encontré ${
          searchRes.candidates.length === 1
            ? "este perfil"
            : `${searchRes.candidates.length} posibles coincidencias`
        } en LinkedIn. **Antes de realizar cualquier acción, confírmame si es la persona correcta:**`,
        spokenText: `Encontré a ${searchRes.candidates[0].name}. Por favor confirma en pantalla si es la persona correcta.`,
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

    // 4B. Creación / Modelado de Post Viral (con búsqueda real en Viral Radar + Aprobación)
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
            .map((t) => ({
              text: t.fullContent,
              reaction_counter: t.likes,
              comment_counter: t.comments,
            }));
        }

        referencePostsText = viralItems
          .slice(0, 5)
          .map(
            (p, idx) =>
              `Post #${idx + 1} (${p.reaction_counter || 0} likes, ${p.comment_counter || 0} comentarios):\n${String(
                p.text || ""
              ).slice(0, 350)}`
          )
          .join("\n---\n");
      }

      const modeled = await generatePostApprovalData({
        topicOrInstruction: message,
        kbContext: kb.contextText,
        companyName: kb.companyName,
        referencePostsText,
      });

      const approval: ApprovalActionPayload = {
        type: "post",
        title: modeled.title,
        preview: modeled.content,
        scheduledAt: classified.scheduledDateIso || undefined,
      };

      return NextResponse.json({
        ok: true,
        reply: `✍️ **Preparé este borrador** ${
          referencePostsText ? "analizando los posts con mayor tracción del tema y " : ""
        }usando la voz de **${kb.companyName || "tu empresa"}**.\n\n*${modeled.summaryNote}*\n\nRevisa y elige si quieres **Publicar ahora**, **Editar**, **Agendar** o **Descartar**:`,
        spokenText: `Preparé tu publicación de LinkedIn. Revísala para aprobarla, editarla o agendarla.`,
        emotion: "excited",
        cards: [{ type: "approval", data: { approval } }],
      } as BotCommandResponse);
    }

    // =========================================================================
    // 5. CONVERSACIÓN GENERAL / ESTRATEGIA CON GEMINI + BASE DE CONOCIMIENTO
    // =========================================================================
    const snap = getPlatformSummary();
    const turns = buildHistoryTurns(history);
    turns.push({ role: "user", parts: [{ text: message || "Hola" }] });

    const aiReply = await callGeminiMultimodal({
      systemPrompt: `Eres "InhubBot", el agente móvil de Social Selling en LinkedIn de InhubFlow.
Hablas siempre en español de forma clara, ejecutiva y directa (pensado para leerse fácil en celular).

REGLA DE ORO: Nunca inventes métricas ni ejecutes acciones externas sin confirmación.
Capacidades que tienes en este chat:
- Analizar fotos de revistas/artículos y modelar posts para aprobar antes de publicar.
- Buscar personas en LinkedIn, mostrar su foto de perfil y grado de conexión (1°, 2° o 3°), y proponer conexión, comentario en su último post o mensaje/propuesta.
- Buscar posts virales y crear borradores listos para publicar o agendar.
- Mostrar métricas en tiempo real, campañas y prospectos del Signal Radar.

Estado actual de la plataforma:
- Cuentas LinkedIn activas: ${snap.accounts.active}/${snap.accounts.total}
- Prospectos CRM: ${snap.leads.total} (${snap.leads.qualified} alta intención)
- Campañas activas: ${snap.campaigns.active}/${snap.campaigns.total}
- Posts: ${snap.posts.published} publicados, ${snap.posts.scheduled} programados, ${snap.posts.draft} borradores

Base de Conocimiento de la empresa (${kb.companyName || "InhubFlow"}):
${kb.contextText.slice(0, 3500)}`,
      turns,
      temperature: 0.7,
      maxOutputTokens: 700,
    });

    const finalReply =
      aiReply.ok && aiReply.text
        ? aiReply.text
        : `Entendido. Puedo ayudarte a:\n\n* **Buscar a una persona** (*"Busca a Juan Pérez de TechCorp y envíale propuesta"*)\n* **Comentar un post** (*"Comenta la última publicación de Carlos Ruiz"*)\n* **Modelar desde foto** (adjunta una foto de revista o artículo)\n* **Crear posts virales** o ver tu **resumen del día**.\n\n¿Qué hacemos ahora?`;

    return NextResponse.json({
      ok: true,
      reply: finalReply,
      spokenText: finalReply.replace(/[*_#`[\]()]/g, "").slice(0, 220),
      emotion: "talking",
      quickActions: [
        "Dame el resumen de hoy",
        "Crear post viral",
        "¿Cómo van las campañas?",
        "Últimos prospectos del radar",
      ],
    } as BotCommandResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error al procesar el comando del bot";
    console.error("[Bot Command API Error]:", error);
    return NextResponse.json(
      {
        ok: false,
        reply: `Ocurrió un error al procesar tu solicitud: ${message}`,
        spokenText: "Ocurrió un error al procesar el comando.",
        emotion: "thinking",
      },
      { status: 500 }
    );
  }
}
