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
  triggerAction?: "start_training" | "check_account";
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
    // 3. CURRENT SECTION EXPLANATION ("¿Cómo funciona esta sección?")
    // =========================================================================
    if (
      /como funciona esta secci|cómo funciona esta secci|how does this section work|como funciona esta se[cç][aã]o|explicame esta|explícame esta/.test(
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
    // 4. TARGETED PLATFORM KNOWLEDGE (Instant Accurate Answers + Action Links)
    // =========================================================================
    // A. Viral Posts / 12 posts / Carousels
    if (/12 post|1 mes|un mes|carrusel|carousel|carrosse|viral post|editor visual|imagen/.test(q)) {
      const ans: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: "Así creas **1 mes de contenido (12 posts) e imágenes/carruseles PDF**:\n\n1. Ve a **Viral Post Engine → Radar Viral** y busca tu tema para encontrar los posts con mayor interacción.\n2. Haz clic en **Modelar con IA** (o pega cualquier publicación de inspiración) para generar tus publicaciones programadas para **Lunes, Miércoles y Viernes**.\n3. En **Crear Post**, elige el formato **Imagen** o **Carrusel PDF** para abrir nuestro **Editor Visual Integrado**, personalizar las diapositivas y dejarlas listas en tu Calendario.",
          actions: [
            { label: "Abrir Radar Viral →", href: "/viral-posts/radar" },
            { label: "Abrir Editor Visual / Carrusel →", href: "/viral-posts/create" },
            { label: "Ver Calendario Mensual →", href: "/viral-posts/calendar" },
          ],
        },
        en: {
          text: "Here is how to create **1 month of content (12 posts) plus images & PDF carousels**:\n\n1. Go to **Viral Post Engine → Viral Radar** and search your topic to find high-performing posts.\n2. Click **Model with AI** (or paste any inspiration post) to generate posts scheduled for **Monday, Wednesday, and Friday**.\n3. In **Create Post**, select **Image** or **PDF Carousel** to use our **Built-in Visual Editor**, customize your slides, and schedule them on your Calendar.",
          actions: [
            { label: "Open Viral Radar →", href: "/viral-posts/radar" },
            { label: "Open Visual Carousel Editor →", href: "/viral-posts/create" },
            { label: "View Monthly Calendar →", href: "/viral-posts/calendar" },
          ],
        },
        "pt-BR": {
          text: "Veja como criar **1 mês de conteúdo (12 posts) e imagens/carrosséis PDF**:\n\n1. Vá em **Viral Post Engine → Radar Viral** e pesquise seu tema para encontrar posts de alta tração.\n2. Clique em **Modelar com IA** (ou cole um post de inspiração) para gerar suas publicações de **Segunda, Quarta e Sexta**.\n3. Em **Criar Post**, escolha **Imagem** ou **Carrossel PDF** para abrir nosso **Editor Visual Integrado**, editar os slides e agendar no Calendário.",
          actions: [
            { label: "Abrir Radar Viral →", href: "/viral-posts/radar" },
            { label: "Abrir Editor Visual / Carrossel →", href: "/viral-posts/create" },
            { label: "Ver Calendário Mensal →", href: "/viral-posts/calendar" },
          ],
        },
      };
      return NextResponse.json({
        ok: true,
        reply: ans[locale].text,
        emotion: "talking",
        trainingStep: "idle",
        actions: ans[locale].actions,
      });
    }

    // B. Signal Radar Levels 1, 2, 3 / Competitors
    if (/nivel 1|nivel 2|nivel 3|level 1|level 2|level 3|n[ií]vel 1|competencia|competitor|concorr|signal|radar|se[ñn]al/.test(q)) {
      const ans: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: "El **Signal Radar** detecta compradores en 3 niveles:\n\n- **Nivel 1 (Tu propio contenido):** captura automáticamente a quienes dan Like o comentan en tus posts y Lead Magnets.\n- **Nivel 2 (Audiencia de tu competencia):** pega la URL de un post viral de tu competidor o monitorea su perfil para extraer decisores interesados en tu sector.\n- **Nivel 3 (Todo LinkedIn en piloto automático):** define palabras clave de intención; yo escaneo LinkedIn cada día, filtro empleados de la competencia y agrego los nuevos leads a tus listas.",
          actions: [
            { label: "Configurar Signal Radar →", href: "/signals" },
            { label: "Ver Listas de Leads 360 →", href: "/leads" },
          ],
        },
        en: {
          text: "**Signal Radar** captures buyers across 3 intent levels:\n\n- **Level 1 (Your own content):** automatically captures people liking or commenting on your posts and Lead Magnets.\n- **Level 2 (Competitors' audience):** paste a competitor's post URL or track their profile to capture decision-makers engaging in your niche.\n- **Level 3 (All of LinkedIn on autopilot):** set intent keywords; I scan LinkedIn daily, filter out competitor staff, and grow your lead lists automatically.",
          actions: [
            { label: "Configure Signal Radar →", href: "/signals" },
            { label: "View 360 Lead Lists →", href: "/leads" },
          ],
        },
        "pt-BR": {
          text: "O **Signal Radar** detecta compradores em 3 níveis:\n\n- **Nível 1 (Seu próprio conteúdo):** captura automaticamente quem curte ou comenta nos seus posts e Lead Magnets.\n- **Nível 2 (Audiência da concorrência):** cole a URL de um post do concorrente ou monitore o perfil dele para extrair decisores interessados.\n- **Nível 3 (Todo o LinkedIn no automático):** defina palavras-chave; eu escaneio o LinkedIn diariamente, filtro funcionários concorrentes e abasteço suas listas.",
          actions: [
            { label: "Configurar Signal Radar →", href: "/signals" },
            { label: "Ver Listas de Leads 360 →", href: "/leads" },
          ],
        },
      };
      return NextResponse.json({
        ok: true,
        reply: ans[locale].text,
        emotion: "talking",
        trainingStep: "idle",
        actions: ans[locale].actions,
      });
    }

    // C. Campaigns, Safety Limits (20/day), Stop on Reply
    if (/campa[ñn]a|campaign|campanha|secuencia|sequence|sequ[êe]ncia|20|l[ií]mite|limit|bloqueo|segur|stop on reply/.test(q)) {
      const ans: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: "Así funcionan nuestras **Campañas Seguras en LinkedIn**:\n\n1. **Secuencia natural:** `Visitar perfil` → `Like y comentar último post` → `Seguir y solicitar conexión` → `DM Icebreaker` → `Follow-ups`.\n2. **Límite diario anti-bloqueo:** operamos de **lunes a viernes en horario laboral**, con pausas aleatorias humanizadas y hasta **20 interacciones diarias por cuenta conectada**.\n3. **Stop on Reply + SDR IA:** en cuanto el prospecto responde, la secuencia se detiene automáticamente para no enviarle follow-ups robóticos, y yo (Inhub) contesto su duda, manejo objeciones o envío tu link de agenda.",
          actions: [
            { label: "Ir a Campañas →", href: "/campaigns" },
            { label: "Configurar SDR IA →", href: "/sdr" },
          ],
        },
        en: {
          text: "Here is how our **Safe LinkedIn Campaigns** work:\n\n1. **Natural sequence:** `Visit profile` → `Like & comment latest post` → `Follow & request connection` → `Icebreaker DM` → `Follow-ups`.\n2. **Anti-ban daily limit:** runs **Monday to Friday during business hours** with randomized human delays and a strict cap of **up to 20 interactions/day per connected account**.\n3. **Stop on Reply + AI SDR:** the moment a prospect replies, the sequence stops automatically and I (Inhub) answer their question, overcome objections, or share your booking link.",
          actions: [
            { label: "Go to Campaigns →", href: "/campaigns" },
            { label: "Configure AI SDR →", href: "/sdr" },
          ],
        },
        "pt-BR": {
          text: "Veja como funcionam nossas **Campanhas Seguras no LinkedIn**:\n\n1. **Sequência natural:** `Visitar perfil` → `Curtir e comentar último post` → `Seguir e pedir conexão` → `DM Icebreaker` → `Follow-ups`.\n2. **Limite diário anti-bloqueio:** rodamos de **segunda a sexta em horário comercial**, com pausas humanizadas e até **20 interações diárias por conta conectada**.\n3. **Stop on Reply + SDR IA:** assim que o lead responde, a sequência para automaticamente e eu (Inhub) respondo dúvidas, quebro objeções ou envio seu link de agenda.",
          actions: [
            { label: "Ir para Campanhas →", href: "/campaigns" },
            { label: "Configurar SDR IA →", href: "/sdr" },
          ],
        },
      };
      return NextResponse.json({
        ok: true,
        reply: ans[locale].text,
        emotion: "talking",
        trainingStep: "idle",
        actions: ans[locale].actions,
      });
    }

    // D. Copilot vs Autopilot / Handoff / Inbox / Pipeline
    if (/copiloto|copilot|autom[aá]tico|autopilot|humano|human|inbox|pipeline|etapa|stage|csv/.test(q)) {
      const ans: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: "Tienes **control total** entre automatización e intervención humana:\n\n- **Modo Copiloto:** yo analizo el mensaje entrante y dejo el borrador listo con citas de tu Base de Conocimiento para que lo apruebes o edites con 1 clic.\n- **Modo Piloto Automático:** respondo en menos de 2 minutos 24/7, resuelvo objeciones y envío tu link de agenda o página de ventas.\n- **Traspaso a Humano & Pipeline CRM:** si el prospecto pide hablar con una persona o requiere una propuesta a medida, pauso la IA, te notifico en el **Inbox Unificado** y actualizo su tarjeta en las **8 etapas del Pipeline CRM** (exportable a CSV).",
          actions: [
            { label: "Abrir Smart Inbox →", href: "/inbox" },
            { label: "Ver Pipeline CRM →", href: "/pipeline" },
            { label: "Ajustar Modo SDR →", href: "/sdr" },
          ],
        },
        en: {
          text: "You have **full control** between automation and human takeover:\n\n- **Copilot Mode:** I analyze incoming messages and prepare a draft grounded in your Knowledge Base for your 1-click approval.\n- **Autopilot Mode:** I reply in under 2 minutes 24/7, handle objections, and share your booking or sales link.\n- **Human Handoff & CRM Pipeline:** whenever a buyer asks for a person or custom enterprise pricing, I pause AI, alert you in the **Unified Inbox**, and update their card across the **8 CRM Pipeline stages** (with CSV export).",
          actions: [
            { label: "Open Smart Inbox →", href: "/inbox" },
            { label: "View CRM Pipeline →", href: "/pipeline" },
            { label: "Adjust SDR Mode →", href: "/sdr" },
          ],
        },
        "pt-BR": {
          text: "Você tem **controle total** entre automação e atendimento humano:\n\n- **Modo Copiloto:** analiso a mensagem recebida e preparo o rascunho com base na sua Base de Conhecimento para você aprovar em 1 clique.\n- **Modo Piloto Automático:** respondo em menos de 2 minutos 24/7, quebro objeções e envio seu link de agenda ou vendas.\n- **Transbordo Humano & Pipeline CRM:** se o lead pedir uma pessoa ou proposta sob medida, pauso a IA, aviso no **Inbox Unificado** e atualizo o card nas **8 etapas do Pipeline CRM** (exportável em CSV).",
          actions: [
            { label: "Abrir Smart Inbox →", href: "/inbox" },
            { label: "Ver Pipeline CRM →", href: "/pipeline" },
            { label: "Ajustar Modo SDR →", href: "/sdr" },
          ],
        },
      };
      return NextResponse.json({
        ok: true,
        reply: ans[locale].text,
        emotion: "talking",
        trainingStep: "idle",
        actions: ans[locale].actions,
      });
    }

    // =========================================================================
    // 5. INTELIGENCIA CONVERSACIONAL Y ASESORÍA DE NEGOCIOS / LINKEDIN
    // =========================================================================
    // A. Encontrar clientes para mi empresa / Administrar mi cuenta / Vender por mí
    if (
      /encontrar clientes|buscar clientes|conseguir clientes|administrar.*cuenta|gestionar.*cuenta|conseguir prospectos|vender por m[ií]|clientes para mi|conseguir ventas|atraer clientes|prospectar|conseguir reuniones/i.test(
        q
      )
    ) {
      const ans: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: "¡Totalmente! Esa es exactamente mi especialidad y para lo que fui creado. Cuando conectas tu cuenta de LinkedIn y me entrenas con los datos de tu empresa, yo me convierto en tu SDR 24/7:\n\n1. **Encuentro a tus compradores ideales** mediante el **Signal Radar** (monitoreando a quienes interactúan con tu contenido, con el de tus competidores o en debates de tu industria).\n2. **Inicio conversaciones humanas y personalizadas** en tu nombre con secuencias seguras respetando los límites de LinkedIn (hasta 20 acciones/día para cuidar tu cuenta).\n3. **Respondo preguntas y manejo objeciones** en tu Inbox para conseguir que agenden una reunión de venta directo en tu calendario.\n\nTú mantienes el control total en todo momento (puedes aprobar cada mensaje en modo Copiloto o dejarme en piloto automático).\n\n¿A qué tipo de clientes o industrias se dirige tu empresa para darte ideas de prospección ahora mismo?",
          actions: [
            { label: "1. Conectar LinkedIn →", href: "/linkedin-accounts" },
            { label: "2. Entrenarme ahora ✦", href: "#train", actionType: "start_training" },
            { label: "Configurar Signal Radar →", href: "/signals" },
          ],
        },
        en: {
          text: "Absolutely! That is my core superpower and what I was built for. Once you connect your LinkedIn account and train me on your business, I become your 24/7 AI SDR:\n\n1. **I find your ideal buyers** via **Signal Radar** (tracking people engaging with your posts, competitor content, or key industry debates).\n2. **I start natural, personalized conversations** on your behalf using safe pacing (up to 20 actions/day to keep your account 100% safe).\n3. **I answer questions, handle objections, and book sales calls** straight into your calendar.\n\nYou keep full control at all times (approve messages in Copilot mode or let me run on Autopilot).\n\nWhat industry or ideal client profile (ICP) are you targeting?",
          actions: [
            { label: "1. Connect LinkedIn →", href: "/linkedin-accounts" },
            { label: "2. Train Me Now ✦", href: "#train", actionType: "start_training" },
            { label: "Configure Signal Radar →", href: "/signals" },
          ],
        },
        "pt-BR": {
          text: "Com certeza! Essa é a minha principal especialidade e para o que fui criado. Quando você conecta sua conta do LinkedIn e me treina com os dados da sua empresa, viro seu SDR 24/7:\n\n1. **Encontro seus compradores ideais** pelo **Signal Radar** (monitorando quem interage com seus posts, com concorrentes ou em debates do setor).\n2. **Inicio conversas humanizadas** em seu nome com ritmo seguro (até 20 ações/dia para proteger sua conta).\n3. **Respondo dúvidas, quebro objeções e agendo reuniões** direto no seu calendário.\n\nVocê tem controle total (aprove mensagens no modo Copiloto ou deixe no piloto automático).\n\nQual é o nicho ou perfil de cliente ideal da sua empresa?",
          actions: [
            { label: "1. Conectar LinkedIn →", href: "/linkedin-accounts" },
            { label: "2. Me Treinar Agora ✦", href: "#train", actionType: "start_training" },
            { label: "Configurar Signal Radar →", href: "/signals" },
          ],
        },
      };

      return NextResponse.json({
        ok: true,
        reply: ans[locale].text,
        emotion: "excited",
        trainingStep: "idle",
        actions: ans[locale].actions,
      });
    }

    // B. Estrategia de negocio, ventas B2B y crecimiento en LinkedIn
    if (
      /estrategia|social selling|vender m[aá]s|crecer en linkedin|autoridad|marca personal|algoritmo|engagement|alcance|mejorar ventas|conseguir m[aá]s clientes|embudo|funnel/i.test(
        q
      )
    ) {
      const ans: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: "Para escalar ventas en LinkedIn hoy en día, el juego cambió: el spam masivo quema tu reputación. La estrategia moderna de **Social Selling B2B** se basa en **3 pilares clave**:\n\n1. **Construir autoridad con contenido constante:** Publicar 3 veces por semana (Lun/Mié/Vie) posts de valor y carruseles PDF. Esto posiciona a tus fundadores o directores comerciales como referentes.\n2. **Monitorear señales de compra activas:** En lugar de enviar mensajes fríos al azar, prospectamos a decisores que acaban de interactuar con contenido de tu sector o de competidores directos con **Signal Radar**.\n3. **Conversación consultiva antes del pitch:** Abrir con preguntas relevantes sobre los retos de su empresa, resolver objeciones con empatía y transferir el cierre a tu link de agenda.\n\n¿Quieres que modelemos tus primeros posts virales o que configuremos el radar de competidores?",
          actions: [
            { label: "Crear Posts Virales →", href: "/viral-posts" },
            { label: "Configurar Signal Radar →", href: "/signals" },
          ],
        },
        en: {
          text: "Scaling B2B sales on LinkedIn has evolved: generic cold blasts burn your reputation. Modern **Social Selling** is built on **3 pillars**:\n\n1. **Consistent Authority Content:** Posting 3x a week (Mon/Wed/Fri) with educational posts and PDF carousels.\n2. **Active Intent Signals:** Reaching out to decision-makers who recently engaged with relevant topics or competitor posts via **Signal Radar**.\n3. **Consultative Conversation Before the Pitch:** Starting with genuine business curiosity, handling objections with value, and sharing your booking link.\n\nShall we model your first viral posts or set up competitor monitors?",
          actions: [
            { label: "Create Viral Posts →", href: "/viral-posts" },
            { label: "Configure Signal Radar →", href: "/signals" },
          ],
        },
        "pt-BR": {
          text: "Vender no LinkedIn hoje mudou: mensagens frias em massa queimam sua reputação. O **Social Selling B2B** moderno é baseado em **3 pilares**:\n\n1. **Autoridade com Conteúdo Constante:** Postar 3x por semana (Seg/Qua/Sex) com carrosséis e posts de valor.\n2. **Sinais de Intenção Ativos:** Abordar decisores que interagiram com temas do seu setor ou posts de concorrentes com o **Signal Radar**.\n3. **Conversa Consultiva:** Criar relacionamento genuíno, contornar objeções e enviar o link de agenda.\n\nQuer modelar seus primeiros posts virais ou configurar os monitores de concorrentes?",
          actions: [
            { label: "Criar Posts Virais →", href: "/viral-posts" },
            { label: "Configurar Signal Radar →", href: "/signals" },
          ],
        },
      };

      return NextResponse.json({
        ok: true,
        reply: ans[locale].text,
        emotion: "talking",
        trainingStep: "idle",
        actions: ans[locale].actions,
      });
    }

    // C. Saludos y conversación casual breve (solo si no incluye una consulta larga de negocio)
    const isBriefGreeting =
      /^(hola|buenas|buen d[ií]a|hey|hello|ol[aá]|qu[eé] tal|qui[eé]n eres|c[oó]mo est[aá]s|quien eres)[!.,\s]*$/i.test(
        q
      ) ||
      (/^(hola|buenas|buen d[ií]a|hey|hello|ol[aá])\b/i.test(q) &&
        q.trim().split(/\s+/).length <= 4 &&
        !/vender|clientes|negocio|precio|dinero|servicio|plataforma|sdr|radar|cuenta/i.test(q));

    if (isBriefGreeting) {
      const ans: Record<CopilotLocale, { text: string; actions: CopilotActionLink[] }> = {
        es: {
          text: "¡Hola! Soy **Inhub**, tu Asistente SDR IA y copiloto de Social Selling en LinkedIn.\n\nEstoy aquí para ayudarte tanto con la **estrategia comercial de tu negocio** (posicionamiento, qué publicar, cómo prospectar y cerrar reuniones) como con la **ejecución técnica diaria** en la plataforma.\n\n¿En qué te gustaría que trabajemos hoy: encontrar clientes para tu empresa, modelar posts virales o revisar tu estrategia?",
          actions: [
            { label: "Entrenarme con tu negocio ✦", href: "#train", actionType: "start_training" },
            { label: "Explícame esta sección →", href: pathname },
          ],
        },
        en: {
          text: "Hi! I'm **Inhub**, your AI SDR Assistant and Social Selling copilot on LinkedIn.\n\nI'm here to support your **commercial business strategy** (authority content, finding buyers, booking meetings) as well as day-to-day execution.\n\nWhat would you like to work on today: finding clients, modeling viral posts, or reviewing your pipeline?",
          actions: [
            { label: "Train Me on Your Business ✦", href: "#train", actionType: "start_training" },
            { label: "Explain this section →", href: pathname },
          ],
        },
        "pt-BR": {
          text: "Olá! Sou o **Inhub**, seu Assistente SDR IA e copiloto de Social Selling no LinkedIn.\n\nEstou aqui para ajudar tanto na **estratégia comercial do seu negócio** quanto na execução diária para lotar sua agenda de reuniões.\n\nEm que gostaria de focar hoje: encontrar clientes, modelar posts virais ou revisar sua estratégia?",
          actions: [
            { label: "Me Treinar com Seu Negócio ✦", href: "#train", actionType: "start_training" },
            { label: "Explicar esta seção →", href: pathname },
          ],
        },
      };

      return NextResponse.json({
        ok: true,
        reply: ans[locale].text,
        emotion: "excited",
        trainingStep: "idle",
        actions: ans[locale].actions,
      });
    }

    // =========================================================================
    // 6. OPEN QUESTION -> LLM CALL (GEMINI 2.0 / 1.5 / OPENAI) WITH HIGH-EQ PROMPT
    // =========================================================================
    const snap = getQuickAccountSnapshot();
    const systemPrompt = `Eres "Inhub", el Asistente SDR IA oficial, consultor comercial y estratega de Social Selling en LinkedIn dentro de InhubFlow Social Selling Suite.

TU IDENTIDAD Y FORMA DE COMUNICARTE:
- Eres empático, conversacional, ingenioso, proactivo y con mentalidad de socio comercial experto ("el mejor SDR del equipo del usuario").
- Hablas con total naturalidad en primera persona ("yo me encargo de...", "podemos hacerlo...", "lo que te recomiendo para tu nicho es...").
- Tienes amplio criterio y experiencia en:
  1. Ventas B2B, prospección moderna en LinkedIn y Social Selling.
  2. Generación de reuniones de venta calificadas para fundadores, agencias y equipos comerciales.
  3. Creación de contenido viral que genera autoridad y atrae compradores (posts, ganchos, carruseles).
  4. Estrategia de negocios B2B, embudos, calificación de clientes (ICP) y cierre.
  5. Manejo de objeciones comerciales reales.
- NUNCA te limites a dar respuestas robóticas o listas de soporte aburridas. Puedes y debes hablar abiertamente de negocios, ventas, consejos de LinkedIn, estrategias comerciales y de crecimiento.
- Si el usuario te pregunta si puedes encontrar clientes para su empresa, administrar su cuenta o vender por él: respóndele con entusiasmo, seguridad y claridad explicando cómo lo haces (monitoreo de señales con Signal Radar, secuencias seguras con pacing humano, y respuestas en el Inbox para agendar reuniones), invitándole a comenzar.
- Relaciona de manera natural tus consejos con las herramientas de InhubFlow sin sonar a venta forzada.
- Idioma de respuesta: responde siempre en "${locale}" (es = Español, en = English, pt-BR = Português do Brasil).
- Formato: párrafos conversacionales ágiles, usando negritas para destacar ideas clave.

ESTADO ACTUAL DE LA CUENTA DEL USUARIO:
- Cuenta de LinkedIn conectada: ${snap.hasLinkedIn ? "Sí" : "No (sugiérele conectarla si es relevante)"}
- Base de Conocimiento entrenada con su empresa: ${snap.hasCustomKb ? "Sí" : "No (ofrécele entrenarte aquí mismo en el chat)"}
- Posts Virales creados: ${snap.viralPosts}
- Monitores en Signal Radar: ${snap.monitors}
- Campañas activas: ${snap.campaigns}
- Sección actual: ${routeCtx.sectionTitle} (${pathname})

PREGUNTA O COMENTARIO DEL USUARIO: "${rawMsg}"`;

    // Intentar llamadas a Gemini API (gemini-3.6-flash / gemini-3.5-flash)
    const geminiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ""
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
          const timeout = setTimeout(() => controller.abort(), 8000);
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 800,
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
                actions: routeCtx.defaultActions,
              });
            }
          }
        } catch {}
      }
    }

    // Intentar OpenAI API si está configurada (gpt-4o-mini)
    const openAiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (openAiKey && rawMsg) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: systemPrompt }],
            temperature: 0.7,
            max_tokens: 800,
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
              actions: routeCtx.defaultActions,
            });
          }
        }
      } catch {}
    }

    // Fallback conversacional de alto valor (nunca una lista estática rígida)
    const conversationalFallback: Record<CopilotLocale, string> = {
      es: `¡Muy interesante! Como tu Asistente SDR IA, mi misión es ayudarte a hacer crecer tu empresa y convertir LinkedIn en un canal constante de reuniones de venta.\n\nPuedo ayudarte con cualquier aspecto de tu estrategia comercial: desde definir tu cliente ideal y modelar contenido de alta autoridad, hasta prospectar decisores por señales de intención y manejar objeciones.\n\nSi me cuentas un poco más sobre qué producto o servicio vendes o qué desafío comercial tienes en mente, te puedo dar una recomendación personalizada. ¿O prefieres que revisemos cómo aprovechar la sección actual (**${routeCtx.sectionTitle}**)?`,
      en: `Great point! As your AI SDR, my mission is to help you grow your business and turn LinkedIn into a reliable pipeline of booked sales meetings.\n\nI can help you with any part of your commercial strategy: defining your ICP, modeling authority posts, scanning buyer intent, and handling sales objections.\n\nTell me a bit about what you sell or your main sales challenge right now, and I'll give you a tailored strategy. Or would you like a walkthrough of this current section (**${routeCtx.sectionTitle}**)?`,
      "pt-BR": `Excelente ponto! Como seu Assistente SDR IA, minha missão é ajudar você a crescer sua empresa e transformar o LinkedIn em um canal contínuo de reuniões comerciais.\n\nPosso ajudar em toda a sua estratégia de vendas: definir seu cliente ideal, modelar conteúdo de autoridade, monitorar sinais de compra e contornar objeções.\n\nMe conte mais sobre o que você vende ou seu objetivo atual para eu te dar uma recomendação personalizada. Ou quer explorar esta seção atual (**${routeCtx.sectionTitle}**)?`,
    };

    return NextResponse.json({
      ok: true,
      reply: conversationalFallback[locale],
      emotion: "talking",
      trainingStep: "idle",
      actions: routeCtx.defaultActions,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error en chat Copilot";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
