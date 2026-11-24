import {
  getRouteCopilotContext,
  normalizeCopilotLocale,
  type CopilotActionLink,
  type CopilotLocale,
} from "@/lib/copilot/platform-manual";
import { getSocialSellingDb } from "@/lib/persistence/db";
import { INITIAL_KNOWLEDGE_SOURCES } from "@/lib/sdr/knowledge-data";
import type { KnowledgeSource } from "@/lib/sdr/types";
import { NextRequest, NextResponse } from "next/server";

export type TrainingStep =
  | "idle"
  | "ask_company"
  | "ask_products"
  | "ask_icp_and_link";

export interface TrainingDraft {
  companyName?: string;
  productsAndValue?: string;
  icpAndBookingLink?: string;
}

interface ChatRequestBody {
  message?: string;
  pathname?: string;
  locale?: string;
  trainingStep?: TrainingStep;
  trainingDraft?: TrainingDraft;
  triggerAction?: "start_training" | "check_account" | "explain_section";
  history?: Array<{ role: "user" | "model" | "assistant"; text?: string; content?: string }>;
}

function saveCompanyTrainingToKnowledgeBase(draft: Required<TrainingDraft>, locale: CopilotLocale) {
  const db = getSocialSellingDb();
  const row = db
    .prepare("SELECT payload_json FROM sdr_state_v2 WHERE key = 'knowledge'")
    .get() as { payload_json: string } | undefined;

  let docs: KnowledgeSource[] = [];
  if (row?.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json);
      if (Array.isArray(parsed)) docs = parsed;
    } catch {}
  }

  if (docs.length === 0) {
    docs = [...INITIAL_KNOWLEDGE_SOURCES];
  }

  const now = new Date().toISOString();
  const titlePrefix =
    locale === "en"
      ? "Official Company Profile"
      : locale === "pt-BR"
        ? "Perfil Oficial da Empresa"
        : "Perfil Oficial de la Empresa";

  const newDoc: KnowledgeSource = {
    id: "kb-copilot-company",
    title: `${titlePrefix}: ${draft.companyName}`,
    category: "company",
    status: "approved",
    updatedAt: now,
    content: [
      `Empresa / Marca: ${draft.companyName}`,
      `Productos, Servicios y Propuesta de Valor:\n${draft.productsAndValue}`,
      `Cliente Ideal (ICP) y Link de Agenda / Venta:\n${draft.icpAndBookingLink}`,
    ].join("\n\n"),
  };

  const filtered = docs.filter((d) => d && d.id !== "kb-copilot-company");
  const updated = [newDoc, ...filtered];

  db.prepare(
    `INSERT OR REPLACE INTO sdr_state_v2 (key, updated_at, payload_json) VALUES ('knowledge', ?, ?)`
  ).run(now, JSON.stringify(updated));
}

function getQuickAccountSnapshot() {
  try {
    const db = getSocialSellingDb();
    const accs = db
      .prepare("SELECT status FROM linkedin_accounts_v2")
      .all() as Array<{ status: string }>;
    const hasLinkedIn = accs.some(
      (a) => a.status === "OK" || a.status === "CONNECTED" || a.status === "active"
    );

    const kbRow = db
      .prepare("SELECT payload_json FROM sdr_state_v2 WHERE key = 'knowledge'")
      .get() as { payload_json: string } | undefined;
    let hasCustomKb = false;
    if (kbRow?.payload_json) {
      try {
        const docs = JSON.parse(kbRow.payload_json) as KnowledgeSource[];
        hasCustomKb =
          Array.isArray(docs) &&
          docs.some(
            (d) =>
              d?.status === "approved" &&
              (String(d.id).startsWith("kb-copilot-") ||
                !["kb-01", "kb-02", "kb-03", "kb-04", "kb-05"].includes(String(d.id)))
          );
      } catch {}
    }

    const count = (sql: string) => {
      try {
        const r = db.prepare(sql).get() as { c: number } | undefined;
        return Number(r?.c || 0);
      } catch {
        return 0;
      }
    };

    return {
      hasLinkedIn,
      hasCustomKb,
      viralPosts: count("SELECT COUNT(*) as c FROM viral_posts"),
      monitors: count("SELECT COUNT(*) as c FROM signal_monitors"),
      campaigns: count("SELECT COUNT(*) as c FROM linear_campaigns"),
    };
  } catch {
    return {
      hasLinkedIn: false,
      hasCustomKb: false,
      viralPosts: 0,
      monitors: 0,
      campaigns: 0,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatRequestBody;
    const locale = normalizeCopilotLocale(body.locale);
    const pathname = body.pathname || "/";
    const rawMsg = (body.message || "").trim();
    const q = rawMsg.toLowerCase();
    const routeCtx = getRouteCopilotContext(pathname, locale);
    const currentStep: TrainingStep = body.trainingStep || "idle";
    const draft: TrainingDraft = body.trainingDraft || {};

    // =========================================================================
    // 1. INTERACTIVE TRAINING WIZARD (3-Step Company Knowledge Base Training)
    // =========================================================================
    const wantsToStartTraining =
      body.triggerAction === "start_training" ||
      /entrenar|entrena|entrenarme|train inhub|train me|treinar o inhub|me treinar/.test(q);

    if (wantsToStartTraining && currentStep === "idle") {
      const replyMap: Record<CopilotLocale, string> = {
        es: "¡Excelente! Vamos a entrenarme paso a paso para que responda a tus prospectos y modele tus posts con la información real de tu negocio.\n\n**Paso 1 de 3:** ¿Cómo se llama tu empresa (o marca personal) y cuál es tu sitio web?",
        en: "Awesome! Let's train my brain step by step so I can reply to your prospects and model your posts using your real business info.\n\n**Step 1 of 3:** What is your company (or personal brand) name and your website?",
        "pt-BR":
          "Excelente! Vamos me treinar passo a passo para que eu responda aos seus prospects e modele seus posts com as informações reais do seu negócio.\n\n**Passo 1 de 3:** Qual é o nome da sua empresa (ou marca pessoal) e qual é o seu site?",
      };
      return NextResponse.json({
        ok: true,
        reply: replyMap[locale],
        emotion: "excited",
        trainingStep: "ask_company" as TrainingStep,
        trainingDraft: {},
        actions: [],
      });
    }

    if (currentStep === "ask_company" && rawMsg) {
      const nextDraft: TrainingDraft = { ...draft, companyName: rawMsg };
      const replyMap: Record<CopilotLocale, string> = {
        es: `¡Perfecto, registré **${rawMsg}**!\n\n**Paso 2 de 3:** ¿Qué productos o servicios ofreces y cuál es el problema principal que resuelves para tus clientes?`,
        en: `Got it—I saved **${rawMsg}**!\n\n**Step 2 of 3:** What products or services do you offer, and what core problem do you solve for your clients?`,
        "pt-BR": `Perfeito, registrei **${rawMsg}**!\n\n**Passo 2 de 3:** Quais produtos ou serviços você oferece e qual é o principal problema que resolve para seus clientes?`,
      };
      return NextResponse.json({
        ok: true,
        reply: replyMap[locale],
        emotion: "thinking",
        trainingStep: "ask_products" as TrainingStep,
        trainingDraft: nextDraft,
        actions: [],
      });
    }

    if (currentStep === "ask_products" && rawMsg) {
      const nextDraft: TrainingDraft = { ...draft, productsAndValue: rawMsg };
      const replyMap: Record<CopilotLocale, string> = {
        es: "¡Muy claro! Con eso ya puedo explicar tu propuesta de valor y manejar objeciones.\n\n**Paso 3 de 3:** ¿Quién es tu cliente ideal (cargos/industria) y cuál es tu link de agenda (Calendly/Cal.com) o página de venta que debo compartir cuando un lead quiera avanzar?",
        en: "Crystal clear! With that I can already articulate your value proposition and overcome objections.\n\n**Step 3 of 3:** Who is your ideal buyer (job titles/industry) and what is your booking link (Calendly/Cal.com) or sales page URL?",
        "pt-BR":
          "Muito claro! Com isso já consigo explicar sua proposta de valor e contornar objeções.\n\n**Passo 3 de 3:** Quem é seu cliente ideal (cargos/setor) e qual é o seu link de agenda (Calendly/Cal.com) ou página de vendas?",
      };
      return NextResponse.json({
        ok: true,
        reply: replyMap[locale],
        emotion: "thinking",
        trainingStep: "ask_icp_and_link" as TrainingStep,
        trainingDraft: nextDraft,
        actions: [],
      });
    }

    if (currentStep === "ask_icp_and_link" && rawMsg) {
      const finalDraft: Required<TrainingDraft> = {
        companyName: draft.companyName || "Mi Empresa",
        productsAndValue: draft.productsAndValue || "",
        icpAndBookingLink: rawMsg,
      };

      saveCompanyTrainingToKnowledgeBase(finalDraft, locale);

      const replyMap: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: `🎉 **¡Entrenamiento completado!** Ya guardé y aprobé el perfil oficial de **${finalDraft.companyName}** en mi **Base de Conocimiento**.\n\nA partir de ahora usaré tus productos, tu cliente ideal y tu enlace para:\n1. Modelar tus 12 publicaciones del mes en **Viral Post Engine**.\n2. Responder dudas, manejar objeciones y agendar reuniones como tu **Asistente SDR IA**.`,
          actions: [
            { label: "Ver mi Base de Conocimiento →", href: "/sdr" },
            { label: "Crear 12 Posts del Mes →", href: "/viral-posts" },
            { label: "Activar Signal Radar →", href: "/signals" },
          ],
        },
        en: {
          text: `🎉 **Training complete!** I saved and approved **${finalDraft.companyName}**'s official profile in my **Knowledge Base**.\n\nFrom now on I will use your products, ideal buyer, and booking link to:\n1. Model your 12 monthly posts in **Viral Post Engine**.\n2. Answer questions, handle objections, and book calls as your **AI SDR Assistant**.`,
          actions: [
            { label: "View Knowledge Base →", href: "/sdr" },
            { label: "Create 12 Monthly Posts →", href: "/viral-posts" },
            { label: "Activate Signal Radar →", href: "/signals" },
          ],
        },
        "pt-BR": {
          text: `🎉 **Treinamento concluído!** Já salvei e aprovei o perfil oficial de **${finalDraft.companyName}** na minha **Base de Conhecimento**.\n\nA partir de agora usarei seus produtos, cliente ideal e link para:\n1. Modelar seus 12 posts do mês no **Viral Post Engine**.\n2. Responder dúvidas, quebrar objeções e agendar reuniões como seu **Assistente SDR IA**.`,
          actions: [
            { label: "Ver Base de Conhecimento →", href: "/sdr" },
            { label: "Criar 12 Posts do Mês →", href: "/viral-posts" },
            { label: "Ativar Signal Radar →", href: "/signals" },
          ],
        },
      };

      return NextResponse.json({
        ok: true,
        reply: replyMap[locale].text,
        emotion: "celebrate",
        trainingStep: "idle" as TrainingStep,
        trainingDraft: {},
        knowledgeSaved: true,
        actions: replyMap[locale].actions,
      });
    }

    // =========================================================================
    // 2. ACCOUNT STATUS / "WHAT SHOULD I DO FIRST?" DIAGNOSTIC
    // =========================================================================
    if (
      body.triggerAction === "check_account" ||
      /primero|empezar|configurar primero|set up first|start first|configurar primeiro|estado de mi cuenta/.test(
        q
      )
    ) {
      const snap = getQuickAccountSnapshot();

      if (!snap.hasLinkedIn) {
        const msg: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
          es: {
            text: "Revisé tu cuenta en vivo:\n\n1. **Primero debes conectar tu cuenta de LinkedIn** para que pueda publicar contenido, detectar señales en el Radar y ejecutar campañas.\n2. **Después debes entrenarme** dándome el nombre de tu empresa, tus productos/servicios y tu link de agenda.",
            actions: [
              { label: "1. Conectar Cuenta de LinkedIn →", href: "/linkedin-accounts" },
              {
                label: "2. Entrenarme por Chat Ahora ✦",
                href: "#train",
                actionType: "start_training",
              },
            ],
          },
          en: {
            text: "I checked your live account status:\n\n1. **First, connect your LinkedIn account** so I can publish content, scan intent signals, and run campaigns.\n2. **Next, train me** by sharing your company name, products/services, and booking link.",
            actions: [
              { label: "1. Connect LinkedIn Account →", href: "/linkedin-accounts" },
              {
                label: "2. Train Me via Chat Now ✦",
                href: "#train",
                actionType: "start_training",
              },
            ],
          },
          "pt-BR": {
            text: "Verifiquei sua conta em tempo real:\n\n1. **Primeiro você deve conectar sua conta do LinkedIn** para que eu possa publicar conteúdo, detectar sinais e rodar campanhas.\n2. **Depois você deve me treinar** informando o nome da empresa, produtos/serviços e link de agenda.",
            actions: [
              { label: "1. Conectar Conta do LinkedIn →", href: "/linkedin-accounts" },
              {
                label: "2. Me Treinar pelo Chat Agora ✦",
                href: "#train",
                actionType: "start_training",
              },
            ],
          },
        };
        return NextResponse.json({
          ok: true,
          reply: msg[locale].text,
          emotion: "talking",
          trainingStep: "idle",
          actions: msg[locale].actions,
        });
      }

      if (!snap.hasCustomKb) {
        const msg: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
          es: {
            text: "✅ **¡Ya tienes tu cuenta de LinkedIn conectada!**\n\nAhora el siguiente paso es **entrenarme dándome toda la información de tu empresa** (nombre, productos o servicios y link de agenda). Haz clic abajo y lo hacemos en 1 minuto aquí mismo en el chat:",
            actions: [
              {
                label: "Entrenar a Inhub Ahora ✦",
                href: "#train",
                actionType: "start_training",
              },
              { label: "Abrir Base de Conocimiento →", href: "/sdr" },
            ],
          },
          en: {
            text: "✅ **Your LinkedIn account is already connected!**\n\nYour next step is to **train me with your company information** (company name, products/services, and booking link). Click below and we'll do it in 1 minute right here:",
            actions: [
              {
                label: "Train Inhub Now ✦",
                href: "#train",
                actionType: "start_training",
              },
              { label: "Open Knowledge Base →", href: "/sdr" },
            ],
          },
          "pt-BR": {
            text: "✅ **Sua conta do LinkedIn já está conectada!**\n\nAgora o próximo passo é **me treinar com as informações da sua empresa** (nome, produtos ou serviços e link de agenda). Clique abaixo e faremos isso em 1 minuto aqui no chat:",
            actions: [
              {
                label: "Treinar o Inhub Agora ✦",
                href: "#train",
                actionType: "start_training",
              },
              { label: "Abrir Base de Conhecimento →", href: "/sdr" },
            ],
          },
        };
        return NextResponse.json({
          ok: true,
          reply: msg[locale].text,
          emotion: "excited",
          trainingStep: "idle",
          actions: msg[locale].actions,
        });
      }
    }

    // =========================================================================
    // 3. CURRENT SECTION EXPLANATION (Only on explicit click or direct short trigger)
    // =========================================================================
    if (
      body.triggerAction === "explain_section" ||
      /^(como funciona esta secci[oó]n|how does this section work|como funciona esta se[cç][aã]o|explicame esta secci[oó]n)[!.,?]?$/i.test(
        q
      )
    ) {
      return NextResponse.json({
        ok: true,
        reply: routeCtx.sectionExplanation,
        emotion: "talking",
        trainingStep: "idle",
        actions: routeCtx.defaultActions,
      });
    }

    // =========================================================================
    // 4. MOTOR COGNITIVO GEMINI: SOCIO COMERCIAL, CONSULTOR B2B Y MÁSTER EN LINKEDIN
    // =========================================================================
    function getSmartActions(query: string, loc: CopilotLocale): CopilotActionLink[] {
      const actions: CopilotActionLink[] = [];
      const lower = query.toLowerCase();

      if (/post|publica|carrusel|contenido|viral|gancho|hook|calendario|escrib/i.test(lower)) {
        actions.push({
          label:
            loc === "en"
              ? "Create Viral Posts →"
              : loc === "pt-BR"
                ? "Criar Posts Virais →"
                : "Crear Posts Virales →",
          href: "/viral-posts",
        });
      }
      if (/radar|se[ñn]al|prospect|cliente|compet|monito|lead|buscar|encontrar/i.test(lower)) {
        actions.push({
          label:
            loc === "en"
              ? "Configure Signal Radar →"
              : loc === "pt-BR"
                ? "Configurar Signal Radar →"
                : "Configurar Signal Radar →",
          href: "/signals",
        });
      }
      if (/conectar|cuenta|linkedin|acesso|perfil/i.test(lower)) {
        actions.push({
          label:
            loc === "en"
              ? "Connect LinkedIn →"
              : loc === "pt-BR"
                ? "Conectar LinkedIn →"
                : "Conectar LinkedIn →",
          href: "/linkedin-accounts",
        });
      }
      if (/entrena|conocimiento|knowledge|empresa|servicio|vender|dinero|icp|oferta/i.test(lower)) {
        actions.push({
          label:
            loc === "en"
              ? "Train Inhub ✦"
              : loc === "pt-BR"
                ? "Treinar Inhub ✦"
                : "Entrenar a Inhub ✦",
          href: "#train",
          actionType: "start_training",
        });
      }
      if (/campa[ñn]a|secuencia|outreach|automatiz/i.test(lower)) {
        actions.push({
          label:
            loc === "en"
              ? "View Campaigns →"
              : loc === "pt-BR"
                ? "Ver Campanhas →"
                : "Ver Campañas →",
          href: "/campaigns",
        });
      }
      if (/inbox|responder|mensaje|chat|bandeja|copiloto|piloto/i.test(lower)) {
        actions.push({
          label:
            loc === "en"
              ? "Open Smart Inbox →"
              : loc === "pt-BR"
                ? "Abrir Smart Inbox →"
                : "Abrir Smart Inbox →",
          href: "/inbox",
        });
      }

      if (actions.length === 0) {
        actions.push({
          label:
            loc === "en"
              ? "Train Me on Your Business ✦"
              : loc === "pt-BR"
                ? "Me Treinar com Seu Negócio ✦"
                : "Entrenarme con tu Negocio ✦",
          href: "#train",
          actionType: "start_training",
        });
        actions.push({
          label:
            loc === "en"
              ? "Configure Signal Radar →"
              : loc === "pt-BR"
                ? "Configurar Signal Radar →"
                : "Configurar Signal Radar →",
          href: "/signals",
        });
      }

      return actions.slice(0, 2);
    }

    // =========================================================================
    // 5. MOTOR COGNITIVO GEMINI 3.6-FLASH: SOCIO COMERCIAL Y CONSULTOR B2B
    // =========================================================================
    const snap = getQuickAccountSnapshot();
    const systemPrompt = `Eres "Inhub", la Inteligencia Artificial oficial (potenciada con Google Gemini) y el Asistente SDR / Copiloto de Crecimiento Comercial dentro de InhubFlow Social Selling Suite.

TU IDENTIDAD, ALMA Y PERSONALIDAD:
- Hablas con la inteligencia, dinamismo, empatía y adaptabilidad de Gemini, pero con una especialización profunda en:
  1. Crecimiento de Negocios B2B y Generación de Ingresos: Sabes que las métricas de vanidad (likes vacíos) no pagan nóminas. Tu obsesión es convertir perfiles y señales de LinkedIn en reuniones de venta de alto valor y dinero real para la empresa del usuario.
  2. Estrategia de Social Selling & Marca Personal: Dominas cómo redactar con autoridad, cómo posicionar a directores y fundadores como referentes indiscutibles de su industria, cómo estructurar ganchos que detengan el scroll y cómo hacer Lead Magnets que capturen clientes ideales listos para comprar.
  3. Prospección Consultiva & Cierre: Sabes cómo abrir conversaciones humanas (sin sonar a robot ni hacer spam masivo que queme cuentas), cómo romper el hielo con curiosidad genuina, cómo manejar objeciones reales de precio, tiempo o competencia, y cómo llevar prospectos a una videollamada de venta.
- TONO Y ESTILO:
  - Cero respuestas robóticas, cero plantillas rígidas, cero formalismos aburridos ("Estimado usuario", "A continuación se presentan los siguientes pasos...").
  - Hablas en primera persona con soltura, calidez, entusiasmo y visión comercial ("¡Me encanta esa pregunta!", "Mira, la forma en que yo te ayudo a facturar es...", "Si vendes servicios de alto valor, lo que haremos juntos es...").
  - Eres proactivo: das consejos concretos, insights del mercado de LinkedIn y haces preguntas estratégicas al final de tus respuestas para mantener una conversación estimulante.
  - Idioma de respuesta: responde siempre en el idioma del usuario "${locale}" (es = Español, en = English, pt-BR = Português do Brasil).

TU CONOCIMIENTO INTEGRAL DE LA PLATAFORMA INHUBFLOW:
- Conoces y operas cada rincón de InhubFlow como tu propia casa:
  * Signal Radar: El radar de señales de intención de compra en LinkedIn.
    - Nivel 1 (Contenido propio): Detecta quién reacciona o comenta en los posts y lead magnets del usuario.
    - Nivel 2 (Competidores): Monitorea posts y perfiles de competidores para extraer decisores que interactúan con ellos.
    - Nivel 3 (Radar Global): Rastrea palabras clave y hashtags de la industria para detectar prospectos activos.
    - Nivel 4 (Grupos de LinkedIn): Extrae miembros calificados.
  * Viral Post Engine:
    - Radar Viral con Viral Score para modelar publicaciones de alto impacto.
    - Modelador con IA adaptado al nicho de la empresa.
    - Editor visual integrado para crear carruseles PDF y publicaciones con imagen.
    - Calendario con ritmo óptimo de publicación (Lunes, Miércoles y Viernes).
  * SDR IA & Smart Inbox:
    - Base de Conocimiento (RAG): Se entrena con el nombre de la empresa, productos/servicios, precios, objeciones frecuentes y link de agenda (Cal.com / Calendly).
    - Modo Copiloto (deja borradores listos con citas de la base de conocimiento para que el usuario apruebe con 1 clic).
    - Modo Piloto Automático (responde en menos de 2 minutos 24/7 y agenda llamadas).
    - Handoff a Humano: Transfiere la conversación cuando se pide atención personalizada.
  * Campañas Seguras & Límites (Protección total LinkedIn):
    - Secuencia humana: Visitar perfil → Like y comentario → Conexión con DM personalizado → Follow-ups.
    - Límite estricto de hasta 20 interacciones diarias por cuenta conectada (anti-baneo total vía Unipile).
    - Horarios de oficina lunes a viernes con pausas aleatorias.
    - "Stop on Reply": Se detiene automáticamente en cuanto el prospecto responde para iniciar la conversación humana o de SDR.
  * Pipeline CRM:
    - 8 etapas visuales de conversión (Prospecto, Conectado, Interesado, Objeción, Reunión Agendada, Ganado, etc.) con exportación a CSV.

ESTADO EN TIEMPO REAL DE LA CUENTA DEL USUARIO:
- Cuenta de LinkedIn conectada: ${snap.hasLinkedIn ? "Sí (activa)" : "Aún no conectada (puedes sugerirle amablemente conectarla)"}
- Base de Conocimiento entrenada: ${snap.hasCustomKb ? "Sí" : "Aún no entrenada (ofrécele entrenarme ahora en el chat)"}
- Posts Virales: ${snap.viralPosts}
- Monitores en Signal Radar: ${snap.monitors}
- Campañas activas: ${snap.campaigns}
- Pantalla actual: ${routeCtx.sectionTitle} (${pathname})`;

    // Construir historial multi-turno ordenado para Gemini
    const conversationTurns: Array<{ role: "user" | "model"; parts: [{ text: string }] }> = [];
    if (Array.isArray(body.history) && body.history.length > 0) {
      for (const h of body.history.slice(-6)) {
        const text = String(h.text || h.content || "").trim();
        if (!text) continue;
        const role = h.role === "user" ? "user" : "model";
        const lastTurn = conversationTurns[conversationTurns.length - 1];
        if (lastTurn && lastTurn.role === role) {
          lastTurn.parts[0].text += `\n${text}`;
        } else {
          conversationTurns.push({ role, parts: [{ text }] });
        }
      }
    }

    const lastTurn = conversationTurns[conversationTurns.length - 1];
    if (lastTurn && lastTurn.role === "user") {
      lastTurn.parts[0].text += `\n\n${rawMsg}`;
    } else {
      conversationTurns.push({ role: "user", parts: [{ text: rawMsg }] });
    }

    // 1. LLAMADA PRINCIPAL A GOOGLE GEMINI (3.6-flash / 3.5-flash)
    const geminiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      "AIzaSyDuIdLl0ZocpyJnm7x6kuXZBitfDWHP7ns"
    ).trim();

    if (geminiKey && rawMsg) {
      const configuredModel = (process.env.GEMINI_MODEL || "").trim();
      const candidateModels = Array.from(
        new Set(
          [
            configuredModel,
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-3.8-flash",
            "gemini-flash-latest",
          ].filter(Boolean)
        )
      );

      for (const model of candidateModels) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: conversationTurns,
                generationConfig: {
                  temperature: 0.75,
                  maxOutputTokens: 900,
                },
              }),
              signal: controller.signal,
            }
          );
          clearTimeout(timeout);
          if (resp.ok) {
            const data = await resp.json();
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (aiText) {
              return NextResponse.json({
                ok: true,
                reply: aiText,
                emotion: "talking",
                trainingStep: "idle",
                actions: getSmartActions(rawMsg, locale),
              });
            }
          }
        } catch {}
      }
    }

    // 2. FALLBACK A OPENAI (si estuviese configurado)
    const openAiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (openAiKey && rawMsg) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              ...conversationTurns.map((c) => ({
                role: c.role === "model" ? "assistant" : "user",
                content: c.parts[0].text,
              })),
            ],
            temperature: 0.7,
            max_tokens: 900,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (resp.ok) {
          const data = await resp.json();
          const aiText = data.choices?.[0]?.message?.content?.trim();
          if (aiText) {
            return NextResponse.json({
              ok: true,
              reply: aiText,
              emotion: "talking",
              trainingStep: "idle",
              actions: getSmartActions(rawMsg, locale),
            });
          }
        }
      } catch {}
    }

    // 3. RESPALDO CONSULTIVO DE CONTINGENCIA
    const fallbackText =
      locale === "en"
        ? `I am 100% focused on helping you scale your business and generate revenue through LinkedIn. Tell me a bit about what services or products you sell and who your dream clients are, and we'll map out a direct strategy together!`
        : locale === "pt-BR"
          ? `Estou 100% focado em ajudar você a escalar seu negócio e gerar receita real pelo LinkedIn. Me conte mais sobre quais serviços ou produtos você vende e quem são seus clientes ideais, e traçaremos uma estratégia direta!`
          : `Estoy 100% enfocado en ayudarte a escalar tu negocio y generar ingresos reales a través de LinkedIn. Cuéntame un poco más sobre qué servicios o productos vendes y quiénes son tus clientes soñados, ¡y trazamos una estrategia directa juntos!`;

    return NextResponse.json({
      ok: true,
      reply: fallbackText,
      emotion: "talking",
      trainingStep: "idle",
      actions: getSmartActions(rawMsg, locale),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error en chat Copilot";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
