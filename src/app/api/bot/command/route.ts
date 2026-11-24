import { getSocialSellingDb } from "@/lib/persistence/db";
import { NextRequest, NextResponse } from "next/server";

export interface BotActionCard {
  type: "summary" | "campaigns" | "post" | "leads" | "accounts";
  data: any;
}

interface BotCommandResponse {
  ok: boolean;
  reply: string;
  emotion: "idle" | "talking" | "thinking" | "happy" | "excited";
  cards?: BotActionCard[];
  quickActions?: string[];
  spokenText?: string;
}

function getPlatformSummary() {
  const db = getSocialSellingDb();
  const count = (sql: string, params: any[] = []) => {
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
    activeAccounts = accs.filter(a => a.status === "OK" || a.status === "CONNECTED" || a.status === "active").length;
  } catch {
    accountsCount = count("SELECT COUNT(*) as c FROM linkedin_accounts");
    activeAccounts = count("SELECT COUNT(*) as c FROM linkedin_accounts WHERE status = 'OK' OR status = 'CONNECTED'");
  }

  // Today pacing
  const today = new Date().toISOString().split("T")[0];
  let todayDms = 0;
  let todayInvites = 0;
  try {
    const pacing = db.prepare(
      "SELECT SUM(dms_sent) as d, SUM(invitations_sent) as i FROM campaign_daily_pacing_v2 WHERE action_date = ?"
    ).get(today) as { d?: number; i?: number } | undefined;
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
    const rows = db.prepare("SELECT * FROM linear_campaigns ORDER BY code ASC LIMIT 10").all() as any[];
    return rows.map((r) => {
      let meta: any = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch {}
      return {
        id: r.id,
        name: meta.name || r.name,
        code: meta.code || r.code,
        status: meta.status || r.status || "active",
        leadsCount: meta.leadsCount || 0,
      };
    });
  } catch {
    return [];
  }
}

function toggleCampaignStatus(campaignId: string, targetStatus: "active" | "paused") {
  const db = getSocialSellingDb();
  try {
    const row = db.prepare("SELECT metadata_json FROM linear_campaigns WHERE id = ?").get(campaignId) as any;
    let meta: any = {};
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
    const rows = db.prepare("SELECT * FROM crm_leads_360 ORDER BY created_at DESC LIMIT 6").all() as any[];
    return rows.map((r) => {
      let meta: any = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch {}
      return {
        id: r.id,
        name: r.full_name,
        headline: meta.headline || meta.title || "Tomador de decisión B2B",
        stage: r.stage,
        score: r.intent_score,
        profileUrl: r.linkedin_url || "#",
      };
    });
  } catch {
    return [];
  }
}

function createViralPostDraft(title: string, topic: string, scheduledDate?: string) {
  const db = getSocialSellingDb();
  const id = `post-${Date.now()}`;
  const now = new Date().toISOString();
  const format = "text";
  
  const content = [
    `El mayor error que cometen las empresas B2B al prospectar en LinkedIn es vender en el primer mensaje.\n`,
    `Si quieres agendar llamadas de alto valor sobre ${topic}, sigue este sistema de 3 pasos:\n`,
    `1. Aporta valor real con un contenido de autoridad o caso de estudio.`,
    `2. Identifica quién interactúa y muestra intención de compra mediante señales.`,
    `3. Inicia una conversación respetuosa y envía tu enlace de agenda solo cuando el prospecto lo solicita.\n`,
    `¿Quieres recibir la plantilla exacta que utilizamos?`,
    `Comenta la palabra "SISTEMA" abajo y te la envío directamente por mensaje privado.`,
  ].join("\n");

  const status = scheduledDate ? "scheduled" : "draft";

  db.prepare(`
    INSERT INTO viral_posts (
      id, workspace_id, title, format, content, status, scheduled_at, created_at,
      lead_magnet_keyword, auto_dm_enabled, auto_dm_message, auto_like_comment, metadata_json
    ) VALUES (?, 'default', ?, ?, ?, ?, ?, ?, 'SISTEMA', 1, '¡Hola! Aquí tienes la plantilla del sistema.', 1, '{}')
  `).run(id, title, format, content, status, scheduledDate || null, now);

  return {
    id,
    title,
    content,
    status,
    scheduledAt: scheduledDate,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const message = String(body.message || "").trim();
    const action = String(body.action || "").trim();
    const payload = body.payload || {};
    const lower = message.toLowerCase();

    // 1. Acción explícita desde tarjeta interactiva: Pausar / Activar Campaña
    if (action === "toggle_campaign" && payload?.campaignId && payload?.status) {
      const ok = toggleCampaignStatus(payload.campaignId, payload.status);
      const campaigns = getCampaignsList();
      const statusText = payload.status === "active" ? "activada" : "pausada";
      return NextResponse.json({
        ok,
        reply: `Listo. La campaña **${payload.campaignName || payload.campaignId}** ha sido **${statusText}** con éxito.`,
        spokenText: `Campaña ${statusText} correctamente.`,
        emotion: "talking",
        cards: [
          {
            type: "campaigns",
            data: { campaigns },
          },
        ],
        quickActions: ["Ver resumen del día", "Crear post viral", "Ver prospectos"],
      } as BotCommandResponse);
    }

    // 2. Intención: Resumen, Reporte o Estadísticas generales
    if (
      action === "get_summary" ||
      /resumen|reporte|m[eé]tricas|estad[ií]sticas|c[oó]mo va|estado general|balance|panel|stats/i.test(lower)
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
        `\n${accountsOk ? "¿Qué acción estratégica deseas ejecutar ahora?" : "Recuerda conectar una cuenta de LinkedIn para que las campañas comiencen a operar."}`,
      ].join("\n");

      const spokenText = `Tienes ${snap.leads.total} prospectos en CRM y ${snap.campaigns.active} campañas activas. ${snap.posts.scheduled} publicaciones programadas. Todo opera con normalidad.`;

      return NextResponse.json({
        ok: true,
        reply,
        spokenText,
        emotion: "talking",
        cards: [
          {
            type: "summary",
            data: snap,
          },
        ],
        quickActions: [
          "Ver campañas activas",
          "Crear post viral",
          "Ver prospectos de hoy",
          "Estado de cuentas",
        ],
      } as BotCommandResponse);
    }

    // 3. Intención: Campañas (Listar, pausar, revisar)
    if (action === "list_campaigns" || /campa[ñn]as|secuencias|flujos|linear/i.test(lower)) {
      const campaigns = getCampaignsList();
      const activeCount = campaigns.filter(c => c.status === "active").length;
      
      const reply = campaigns.length > 0
        ? `Tienes **${campaigns.length} campañas configuradas** (${activeCount} activas). Puedes pausar o activar cualquiera directamente desde aquí:`
        : `Aún no tienes campañas lineales creadas. Puedes configurar una en el constructor del dashboard.`;

      const spokenText = `Tienes ${activeCount} campañas activas de un total de ${campaigns.length}.`;

      return NextResponse.json({
        ok: true,
        reply,
        spokenText,
        emotion: "talking",
        cards: campaigns.length > 0 ? [{ type: "campaigns", data: { campaigns } }] : [],
        quickActions: ["Crear post viral", "Ver resumen de métricas", "Ver prospectos"],
      } as BotCommandResponse);
    }

    // 4. Intención: Crear o Programar Post Viral
    if (
      action === "create_post" ||
      /crear post|nuevo post|escribe un post|publicar|programar post|carrusel|gancho viral/i.test(lower)
    ) {
      // Extraer posible tema
      let topic = "prospección B2B y social selling";
      if (lower.includes("sobre ")) {
        topic = message.split(/sobre /i)[1]?.slice(0, 80) || topic;
      } else if (lower.includes("de ")) {
        topic = message.split(/de /i)[1]?.slice(0, 80) || topic;
      }

      // Extraer si se pide programar para fecha o día
      let scheduledDate: string | undefined = undefined;
      if (/mi[eé]rcoles/i.test(lower)) {
        const d = new Date();
        d.setDate(d.getDate() + ((3 + 7 - d.getDay()) % 7 || 7));
        d.setHours(10, 0, 0, 0);
        scheduledDate = d.toISOString();
      } else if (/ma[ñn]ana/i.test(lower)) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(10, 0, 0, 0);
        scheduledDate = d.toISOString();
      }

      const post = createViralPostDraft(`Sistema de Adquisición sobre ${topic}`, topic, scheduledDate);

      const reply = [
        `He generado y ${post.scheduledAt ? "**programado**" : "guardado como **borrador**"} una nueva publicación optimizada para LinkedIn con gancho viral y Lead Magnet integrado:`,
        `\n**Título:** ${post.title}`,
        `**Estado:** ${post.status === "scheduled" ? "Programado en Calendario" : "Borrador"}`,
        `**Palabra clave Lead Magnet:** "SISTEMA" (Auto-DM activado para enviar el recurso en cuanto comenten).`,
      ].join("\n");

      const spokenText = `Post generado con gancho viral sobre ${topic} y guardado con éxito.`;

      return NextResponse.json({
        ok: true,
        reply,
        spokenText,
        emotion: "excited",
        cards: [
          {
            type: "post",
            data: post,
          },
        ],
        quickActions: ["Ver resumen general", "Ver campañas", "Ver prospectos"],
      } as BotCommandResponse);
    }

    // 5. Intención: Prospectos / Leads / Radar
    if (/prospect|leads|contactos|radar|se[ñn]ales|qui[eé]n interactu[oó]/i.test(lower)) {
      const leads = getRecentLeads();
      const reply = leads.length > 0
        ? `Aquí tienes los **últimos prospectos con alta intención de compra** captados por tu Signal Radar y secuencias:`
        : `Aún no hay prospectos registrados recientemente. Tus monitores de señales los captarán automáticamente en cuanto haya nuevas interacciones.`;

      const spokenText = leads.length > 0
        ? `Se han detectado ${leads.length} prospectos clave en el CRM.`
        : `Sin nuevos prospectos por el momento.`;

      return NextResponse.json({
        ok: true,
        reply,
        spokenText,
        emotion: "talking",
        cards: leads.length > 0 ? [{ type: "leads", data: { leads } }] : [],
        quickActions: ["Ver resumen del día", "Crear post viral", "Ver campañas"],
      } as BotCommandResponse);
    }

    // 6. Intención: Estado de cuentas de LinkedIn
    if (/cuenta|linkedin|conectar|perfil|unipile/i.test(lower)) {
      const snap = getPlatformSummary();
      const isConnected = snap.accounts.active > 0;

      const reply = isConnected
        ? `Tu cuenta de LinkedIn está **conectada y operativa**. El sistema está trabajando respetando el límite seguro de interacciones diarias de lunes a viernes.`
        : `No tienes ninguna cuenta de LinkedIn activa en este momento. Conéctala desde la sección de **Cuentas de LinkedIn** en el dashboard para habilitar la prospección.`;

      const spokenText = isConnected
        ? `Tu cuenta de LinkedIn está conectada y protegida.`
        : `Por favor conecta tu cuenta de LinkedIn para iniciar la prospección.`;

      return NextResponse.json({
        ok: true,
        reply,
        spokenText,
        emotion: isConnected ? "talking" : "thinking",
        cards: [
          {
            type: "accounts",
            data: snap.accounts,
          },
        ],
        quickActions: ["Ver resumen de métricas", "Crear post viral", "Ver campañas"],
      } as BotCommandResponse);
    }

    // 7. Respuesta consultiva / conversacional general (estrategia, monetización, ayuda)
    const reply = [
      `Entendido. Como tu copiloto de Social Selling en LinkedIn, puedo ejecutar acciones concretas en tu plataforma:`,
      `\n* **Reportes:** Pídeme *"Dame el resumen de hoy"* o *"Métricas de la semana"* para ver KPIs y pacing.`,
      `* **Campañas:** Dime *"¿Cómo van las campañas?"* o *"Pausa la campaña X"* para gestionarlas.`,
      `* **Publicaciones:** Pídeme *"Crea un post viral sobre [tu tema]"* y lo dejaré programado con Lead Magnet.`,
      `* **Prospectos:** Pregúntame *"¿Cuáles son los últimos leads del radar?"* para revisar decisores listos para contactar.`,
      `\n¿Qué te gustaría que hagamos ahora?`,
    ].join("\n");

    return NextResponse.json({
      ok: true,
      reply,
      spokenText: `¿Qué acción deseas ejecutar? Puedo mostrarte el resumen, tus campañas, crear publicaciones o revisar prospectos.`,
      emotion: "idle",
      quickActions: [
        "Resumen de hoy",
        "Crear post viral",
        "Estado de campañas",
        "Últimos prospectos",
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
