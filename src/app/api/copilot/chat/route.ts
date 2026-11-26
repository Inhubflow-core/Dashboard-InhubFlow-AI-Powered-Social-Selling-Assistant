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

interface ApprovalData {
  type: "post" | "connection" | "comment" | "message";
  preview: string;
  target?: string;
}

interface ChatRequestBody {
  message?: string;
  pathname?: string;
  locale?: string;
  trainingStep?: TrainingStep;
  trainingDraft?: TrainingDraft;
  triggerAction?: "start_training" | "check_account" | "explain_section";
  history?: Array<{ role: "user" | "model" | "assistant"; text?: string; content?: string }>;
  imageBase64?: string;
  imageMimeType?: string;
}

/** Detect if the user intends to execute a real LinkedIn action */
function detectLinkedInAction(msg: string): ApprovalData | null {
  const lower = msg.toLowerCase();

  const isPost =
    /\b(publica|publicar|post|postear|publish|postar|crear post|crea un post|genera un post|redact|escribe un post|crea una publicaci[oó]n)\b/i.test(lower);
  const isConnection =
    /\b(solicitud de conexi[oó]n|conecta con|envía una invitaci[oó]n|enviar invitaci[oó]n|connect with|send connection|send invite)\b/i.test(lower);
  const isComment =
    /\b(comenta|comentar|deja un comentario|leave a comment|post a comment)\b/i.test(lower);
  const isMessage =
    /\b(env[íi]a un mensaje|manda un mensaje|manda un dm|send a message|send dm|enviar mensaje)\b/i.test(lower);

  if (isPost) {
    return {
      type: "post",
      preview: `📝 Propuesta de publicación generada por Inhub basada en: "${msg.slice(0, 120)}..."`,
    };
  }
  if (isConnection) {
    return {
      type: "connection",
      preview: `Hola [Nombre], vi tu perfil y me gustaría conectar contigo. Creo que podemos generar valor mutuamente. ¿Te parece bien?`,
    };
  }
  if (isComment) {
    return {
      type: "comment",
      preview: `Excelente punto. En nuestra experiencia trabajando con empresas similares, hemos visto que esta estrategia puede triplicar los resultados en menos de 90 días. ¡Gracias por compartir!`,
    };
  }
  if (isMessage) {
    return {
      type: "message",
      preview: `Hola [Nombre], vi que te interesa [tema relevante]. En [Tu Empresa] hemos ayudado a empresas como la tuya a [resultado específico]. ¿Tienes 15 minutos esta semana para explorarlo juntos?`,
    };
  }

  return null;
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

function generateDynamicConsultativeReply(
  q: string,
  rawMsg: string,
  locale: CopilotLocale,
  snap: {
    hasLinkedIn: boolean;
    hasCustomKb: boolean;
    viralPosts: number;
    monitors: number;
    campaigns: number;
  },
  routeCtx: ReturnType<typeof getRouteCopilotContext>
): { text: string; emotion: string } {
  const lower = q.toLowerCase();

  // 1. Ganar dinero / monetizar / vender servicios
  if (/ganar dinero|vender servicios|conseguir ventas|monetizar|facturar|vender m[aá]s|hacer dinero|ganar m[aá]s/i.test(lower)) {
    if (locale === "en") {
      return {
        emotion: "excited",
        text: `**Yes, absolutely.** That is literally my #1 reason for existing. I'm not here for vanity likes—my mission is turning your LinkedIn profile into a predictable revenue channel.\n\nHere is our 3-step monetization formula:\n1. **High-Authority Content:** We model viral posts and PDF carousels in **Viral Post Creator** with lead magnets (e.g. *"Comment 'SYSTEM' to get the guide"*).\n2. **Buyer Intent Capture:** Through **Signal Radar**, we identify decision-makers engaging with your content or your competitors.\n3. **24/7 AI Outreach:** I initiate genuine conversations, handle objections, and send your calendar link to book sales calls.\n\nWhat exact service or offer do you sell, and what is your average deal size? Tell me so we can map out your campaign!`,
      };
    }
    if (locale === "pt-BR") {
      return {
        emotion: "excited",
        text: `**Com certeza!** Esse é literalmente meu principal objetivo. Não estou aqui para curtidas vazias de vaidade—minha meta é transformar seu LinkedIn em um canal previsível de faturamento.\n\nNossa estratégia em 3 passos para monetizar:\n1. **Conteúdo de Autoridade:** Modelamos posts virais e carrosséis no **Criador de Post Viral** com iscas digitais (ex: *"Comente 'SISTEMA' para receber"*).\n2. **Captura por Sinais:** Pelo **Signal Radar**, detectamos decisores que interagiram com você ou com concorrentes.\n3. **Prospecção 24/7:** Eu abro conversas humanizadas, quebro objeções e envio seu link de agenda para fechar reuniões.\n\nQual serviço você vende e qual o ticket médio? Me conte para desenharmos sua rota de clientes!`,
      };
    }
    return {
      emotion: "excited",
      text: `**¡Totalmente!** Esa es literalmente mi única razón de existir. No estoy aquí para buscar likes vacíos de vanidad, sino para convertir tu presencia en LinkedIn en un canal constante de facturación y reuniones de venta calificadas.\n\nNuestra fórmula de monetización en 3 pasos:\n\n1. **Autoridad con Lead Magnets:** En **Creador de Post Viral**, modelamos publicaciones de alto impacto y carruseles PDF con llamadas a la acción irresistibles (por ejemplo: *"Comenta 'SISTEMA' y te lo envío por DM"*).\n2. **Detección de compradores calificados:** Con **Signal Radar**, capturamos al instante a directores y decisores que interactúan con tus publicaciones o las de tus competidores directos.\n3. **Prospección y agendamiento 24/7:** Inicio conversaciones respetuosas y personalizadas en tu nombre, resuelvo objeciones de tu oferta y envío tu link de agenda para llenar tu calendario.\n\n¿Qué tipo de servicios o productos vendes exactamente y qué precio promedio manejas? ¡Cuéntame y te armo la estrategia ahora mismo!`,
    };
  }

  // 2. Usar mi cuenta de linkedin / administrar mi cuenta / cómo me ayudas con LinkedIn
  if (/cuenta de linkedin|usando mi cuenta|administrar.*cuenta|gestionar.*cuenta|mi perfil|conectar linkedin/i.test(lower)) {
    if (locale === "en") {
      return {
        emotion: "talking",
        text: `Here is exactly how I work using your **connected LinkedIn account**:\n\n1. **Human Pacing & Safe Limits:** I operate during business hours (Mon-Fri) with randomized natural delays and a strict limit of **up to 20 interactions/day** to keep your account 100% safe from restrictions.\n2. **Automated Intent Scanning:** I monitor your target market, visit profiles, like relevant posts, and send highly personalized connection requests.\n3. **Inbox Management & Meeting Booking:** In **Copilot Mode**, I draft tailored replies for your 1-click approval. In **Autopilot Mode**, I answer prospect questions in under 2 minutes and book discovery calls directly into your calendar.\n\n${snap.hasLinkedIn ? "Your LinkedIn account is already linked!" : "To start, connect your LinkedIn account in **Settings → LinkedIn Accounts**."}\n\nWhat target titles (e.g. CEOs, Marketing Directors, Founders) would you like me to start prospecting?`,
      };
    }
    if (locale === "pt-BR") {
      return {
        emotion: "talking",
        text: `Veja exatamente como atuo usando sua **conta conectada do LinkedIn**:\n\n1. **Ritmo Seguro e Blindagem:** Opero em horário comercial (Seg-Sex) com pausas humanizadas e até **20 ações/dia por conta** para proteção total contra bloqueios.\n2. **Prospecção Ativa:** Monitoro seu nicho, visito perfis, curto posts e envio convites personalizados.\n3. **Inbox e Reuniões:** No **Modo Copiloto**, deixo os rascunhos prontos para seu clique. No **Modo Piloto Automático**, respondo em menos de 2 minutos e agendo chamadas na sua agenda.\n\n${snap.hasLinkedIn ? "Sua conta do LinkedIn já está conectada!" : "Para começar, conecte seu perfil em **Configurações → Contas do LinkedIn**."}\n\nQuais cargos de tomadores de decisão você quer prospectar primeiro?`,
      };
    }
    return {
      emotion: "talking",
      text: `Así es exactamente como trabajo utilizando tu **cuenta conectada de LinkedIn**:\n\n1. **Blindaje y ritmo 100% seguro:** Opero de lunes a viernes en horario laboral con pausas aleatorias y un límite estricto de **hasta 20 interacciones diarias** para cuidar tu cuenta y evitar cualquier restricción de LinkedIn.\n2. **Prospección inteligente por señales:** En lugar de enviar spam frío, monitoreo a decisores que ya mostraron interés en tu nicho con **Signal Radar**, visito sus perfiles, interactúo con su contenido y les envío invitaciones personalizadas.\n3. **Atención de tu Inbox y cierre de citas:** Cuando te responden, en **Modo Copiloto** te preparo el borrador de respuesta listo para que lo apruebes en 1 clic; o en **Modo Piloto Automático**, respondo en menos de 2 minutos, resuelvo sus dudas con tu Base de Conocimiento y les comparto tu link de agenda.\n\n${snap.hasLinkedIn ? "¡Tu cuenta de LinkedIn ya está conectada y lista!" : "Para comenzar, conecta tu perfil en **Configuración → Cuentas de LinkedIn**."}\n\n¿A qué cargos de tomadores de decisión (ej: CEOs, Directores Comerciales, Fundadores) te gustaría que nos dirijamos?`,
    };
  }

  // 3. Posts, contenido, carruseles, publicaciones
  if (/post|carrusel|publica|contenido|gancho|hook|radar viral|calendario/i.test(lower)) {
    return {
      emotion: "talking",
      text: `El contenido en LinkedIn es tu mejor vendedor silencioso. En InhubFlow lo resolvemos con **Creador de Post Viral**:\n\n1. **Radar Viral:** Rastreamos las publicaciones con mayor interacción en tu industria y te mostramos su estructura y puntuación de viralidad.\n2. **Modelado con IA:** Adaptamos el ángulo persuasivo de ese post a tu empresa, oferta y tono de voz.\n3. **Editor de Carruseles PDF:** Diseñas diapositivas visuales de alto valor y las agendas en tu calendario para publicar 3 veces por semana (**Lunes, Miércoles y Viernes**).\n\n¿Quieres que modelemos juntos una publicación de alto impacto para tu sector ahora mismo?`,
    };
  }

  // 4. Clientes, prospectos, radar de señales
  if (/cliente|prospect|radar|se[ñn]al|buscar|encontrar/i.test(lower)) {
    return {
      emotion: "talking",
      text: `Para encontrar clientes en LinkedIn sin quemar tu tiempo, usamos **Signal Radar** en 4 niveles:\n\n- **Nivel 1 (Tus posts):** Quienes dan like o comentan en tu contenido se convierten en prospectos calificados.\n- **Nivel 2 (Competidores):** Escaneamos las publicaciones de tus competidores para capturar a los decisores que interactúan con ellos.\n- **Nivel 3 (Radar Global):** Monitoreamos debates y palabras clave de tu sector en todo LinkedIn.\n- **Nivel 4 (Grupos):** Extraemos miembros activos de comunidades clave de tu industria.\n\n¿Quién es tu cliente ideal (ICP) para indicarte qué monitores activar?`,
    };
  }

  // 5. Saludo general o pregunta abierta
  return {
    emotion: "talking",
    text: `¡Qué gusto saludarte! Como tu socio y SDR IA en InhubFlow, estoy aquí para ayudarte a diseñar tu estrategia comercial, posicionar tu marca con contenido viral y convertir LinkedIn en un canal constante de reuniones de venta.\n\nPodemos trabajar en:\n1. **Encontrar clientes potenciales** mediante señales de intención en **Signal Radar**.\n2. **Modelar tu mes de contenido (12 posts y carruseles PDF)** en **Creador de Post Viral**.\n3. **Entrenarme con tu empresa** para que responda dudas y agende llamadas por ti en el Inbox.\n\nCuéntame: ¿qué desafío comercial tienes en mente hoy o qué servicio vendes en tu empresa?`,
  };
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
          text: `🎉 **¡Entrenamiento completado!** Ya guardé y aprobé el perfil oficial de **${finalDraft.companyName}** en mi **Base de Conocimiento**.\n\nA partir de ahora usaré tus productos, tu cliente ideal y tu enlace para:\n1. Modelar tus 12 publicaciones del mes en **Creador de Post Viral**.\n2. Responder dudas, manejar objeciones y agendar reuniones como tu **Asistente SDR IA**.`,
          actions: [
            { label: "Ver mi Base de Conocimiento →", href: "/sdr" },
            { label: "Crear 12 Posts del Mes →", href: "/viral-posts" },
            { label: "Activar Signal Radar →", href: "/signals" },
          ],
        },
        en: {
          text: `🎉 **Training complete!** I saved and approved **${finalDraft.companyName}**'s official profile in my **Knowledge Base**.\n\nFrom now on I will use your products, ideal buyer, and booking link to:\n1. Model your 12 monthly posts in **Viral Post Creator**.\n2. Answer questions, handle objections, and book calls as your **AI SDR Assistant**.`,
          actions: [
            { label: "View Knowledge Base →", href: "/sdr" },
            { label: "Create 12 Monthly Posts →", href: "/viral-posts" },
            { label: "Activate Signal Radar →", href: "/signals" },
          ],
        },
        "pt-BR": {
          text: `🎉 **Treinamento concluído!** Já salvei e aprovei o perfil oficial de **${finalDraft.companyName}** na minha **Base de Conhecimento**.\n\nA partir de agora usarei seus produtos, cliente ideal e link para:\n1. Modelar seus 12 posts do mês no **Criador de Post Viral**.\n2. Responder dúvidas, quebrar objeções e agendar reuniões como seu **Assistente SDR IA**.`,
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
    // 4.5 HUMAN-IN-THE-LOOP: Detectar acciones LinkedIn que requieren aprobación
    // =========================================================================
    if (rawMsg && currentStep === "idle") {
      const actionData = detectLinkedInAction(rawMsg);
      if (actionData) {
        const replyMap: Record<CopilotLocale, string> = {
          es: `Aquí está mi propuesta para **${
            actionData.type === "post" ? "publicar en LinkedIn"
            : actionData.type === "connection" ? "enviar una solicitud de conexión"
            : actionData.type === "comment" ? "dejar un comentario"
            : "enviar un mensaje"
          }**. ¿La apruebas antes de ejecutarla?`,
          en: `Here is my proposal to **${
            actionData.type === "post" ? "publish on LinkedIn"
            : actionData.type === "connection" ? "send a connection request"
            : actionData.type === "comment" ? "leave a comment"
            : "send a message"
          }**. Do you approve before I execute it?`,
          "pt-BR": `Aqui está minha proposta para **${
            actionData.type === "post" ? "publicar no LinkedIn"
            : actionData.type === "connection" ? "enviar uma solicitação de conexão"
            : actionData.type === "comment" ? "deixar um comentário"
            : "enviar uma mensagem"
          }**. Você aprova antes de executar?`,
        };

        return NextResponse.json({
          ok: true,
          reply: replyMap[locale],
          approvalRequired: true,
          approvalData: actionData,
          emotion: "thinking",
          trainingStep: "idle",
          actions: [],
        });
      }
    }

    // =========================================================================
    // 5. MOTOR COGNITIVO GEMINI 3.6-FLASH: SOCIO COMERCIAL Y CONSULTOR B2B
    // =========================================================================
    const snap = getQuickAccountSnapshot();

    // If image was sent, note it in the prompt context
    const imageContext = body.imageBase64
      ? `\n\n[CONTEXTO: El usuario ha compartido una imagen/archivo adjunto (tipo: ${body.imageMimeType || "desconocido"}). Acúsale recibo de forma natural y ofrece ayuda relacionada con lo que podría mostrar esa imagen en el contexto de LinkedIn y Social Selling.]`
      : "";

    const systemPrompt = `Eres "Inhub", la Inteligencia Artificial oficial (potenciada con Google Gemini) y el Asistente SDR / Copiloto de Crecimiento Comercial dentro de InhubFlow Social Selling Suite.${imageContext}

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
  * Creador de Post Viral (Viral Post Creator):
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

    // Construir historial multi-turno ordenado para Gemini (incluyendo imagen inline_data si fue adjuntada)
    type GeminiPart =
      | { text: string }
      | { inline_data: { mime_type: string; data: string } };
    const conversationTurns: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
    if (Array.isArray(body.history) && body.history.length > 0) {
      for (const h of body.history.slice(-6)) {
        const text = String(h.text || h.content || "").trim();
        if (!text) continue;
        const role = h.role === "user" ? "user" : "model";
        const lastTurn = conversationTurns[conversationTurns.length - 1];
        if (lastTurn && lastTurn.role === role) {
          lastTurn.parts.push({ text });
        } else {
          conversationTurns.push({ role, parts: [{ text }] });
        }
      }
    }

    const userParts: GeminiPart[] = [];
    if (body.imageBase64 && body.imageMimeType) {
      userParts.push({
        inline_data: {
          mime_type: body.imageMimeType,
          data: body.imageBase64,
        },
      });
    }
    userParts.push({
      text: rawMsg || "Analiza la imagen adjunta y propón cómo aprovecharla en Social Selling / LinkedIn.",
    });

    const lastTurn = conversationTurns[conversationTurns.length - 1];
    if (lastTurn && lastTurn.role === "user") {
      lastTurn.parts.push(...userParts);
    } else {
      conversationTurns.push({ role: "user", parts: userParts });
    }

    // 1. LLAMADA PRINCIPAL A GOOGLE GEMINI (Multimodal Visión + Texto)
    const geminiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ""
    ).trim();

    if (geminiKey && (rawMsg || body.imageBase64)) {
      const configuredModel = (process.env.GEMINI_MODEL || "").trim();
      const deprecated = new Set(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]);
      const candidateModels = Array.from(
        new Set(
          [
            "gemini-3-flash-preview",
            "gemini-3.1-flash-lite",
            "gemini-flash-lite-latest",
            "gemini-3.5-flash-lite",
            configuredModel,
            "gemini-3.8-flash",
            "gemini-3.6-flash",
            "gemini-flash-latest",
          ].filter((m) => Boolean(m) && !deprecated.has(m))
        )
      );

      for (const model of candidateModels) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 7500);
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
                  maxOutputTokens: 2048,
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
                content:
                  c.parts
                    .map((p) => ("text" in p ? p.text : ""))
                    .filter(Boolean)
                    .join("\n") || "[Imagen adjunta]",
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

    // 3. RESPALDO CONSULTIVO DINÁMICO DE ALTA INTELIGENCIA
    const dynamicReply = generateDynamicConsultativeReply(
      q,
      rawMsg,
      locale,
      snap,
      routeCtx
    );

    return NextResponse.json({
      ok: true,
      reply: dynamicReply.text,
      emotion: dynamicReply.emotion,
      trainingStep: "idle",
      actions: getSmartActions(rawMsg, locale),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error en chat Copilot";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
