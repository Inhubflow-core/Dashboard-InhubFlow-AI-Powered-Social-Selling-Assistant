import { INITIAL_KNOWLEDGE_SOURCES } from "@/lib/sdr/knowledge-data";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      hook = "",
      originalContent = "",
      topic = "Social Selling B2B",
      format = "text",
      leadMagnetKeyword = "SISTEMA",
      tone = "Autoridad B2B directa y conversacional",
      targetLanguage = "es",
      includeLeadMagnet = false,
      knowledgeSources = null,
    } = body;

    const normalizedLang = String(targetLanguage || "es").toLowerCase().startsWith("pt")
      ? "pt"
      : String(targetLanguage || "es").toLowerCase().startsWith("en")
      ? "en"
      : "es";
    const targetLangLabel =
      normalizedLang === "pt"
        ? "Portugués brasileño natural, profesional y persuasivo"
        : normalizedLang === "en"
        ? "Inglés profesional natural, directo y persuasivo"
        : "Español profesional natural y persuasivo";

    // 1. Integración Inteligente de la Base de Conocimiento (RAG Multi-Tenant para SaaS)
    const hasCustomKnowledge = Array.isArray(knowledgeSources) && knowledgeSources.length > 0;
    let ragContext = "";
    if (hasCustomKnowledge) {
      ragContext = knowledgeSources
        .map(
          (k: any) =>
            `### [DOCUMENTO ${k.category?.toUpperCase() || "OFICIAL"} DE LA EMPRESA]: ${k.title}\n${k.content}`
        )
        .join("\n\n");
    } else if (topic.toLowerCase().includes("social selling") || topic.toLowerCase().includes("b2b outbound")) {
      // Solo inyectar demo de InhubFlow si el tema es explícitamente Social Selling / Outreach B2B
      ragContext = INITIAL_KNOWLEDGE_SOURCES.filter((k) => k.status === "approved")
        .map(
          (k: any) =>
            `### [DOCUMENTO ${k.category?.toUpperCase() || "OFICIAL"}]: ${k.title}\n${k.content}`
        )
        .join("\n\n");
    }

    const cleanTopic = String(topic || "Tendencias y Negocios").trim();
    const cleanTopicWords = cleanTopic.split(/\s+/).filter(Boolean);
    const topicTag = cleanTopic.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");

    const systemPrompt = `Eres un Master Copywriter en LinkedIn especializado en el framework SLAY (Story → Lesson → Actionable advice → You) y en formato visual ultra-escaneable de alto engagement.
Tu misión es crear una publicación 100% ORIGINAL inspirada en el ángulo del post de referencia, pero completamente adaptada al CONTEXTO DE LA EMPRESA, PROPUESTA DE VALOR E INDUSTRIA DEL CLIENTE: "${cleanTopic}".

${
  ragContext
    ? `CONTEXTO REAL Y PROPUESTA DE VALOR DE LA EMPRESA DEL USUARIO (RAG - ÚSALO COMO BASE PRINCIPAL):
${ragContext}

INSTRUCCIÓN CLAVE DE NEGOCIO: Conecta la historia y la lección con el problema real que resuelve la empresa del usuario, su propuesta de valor y su cliente ideal, sin sonar a anuncio publicitario.`
    : `INSTRUCCIÓN CLAVE DE NEGOCIO: El usuario opera en "${cleanTopic}". Redacta desde la voz de un fundador o especialista en "${cleanTopic}", aportando perspectiva real y lecciones prácticas para sus clientes ideales.`
}

ESTRUCTURA OBLIGATORIA — FRAMEWORK SLAY (4 PARTES):
1. S — Story (Historia / Situación real): Empieza en las primeras 2–3 líneas con un gancho fuerte que frene el scroll antes del "ver más": una situación real con un cliente, un error concreto o un insight vivido.
2. L — Lesson (Lección clara): Extrae cuál fue el problema real detrás de la historia y cuál es la lección clave que aprendiste (en 1–2 frases contundentes).
3. A — Actionable advice (Consejo accionable): Da de 3 a 5 pasos, reglas o tácticas concretas en una lista fácil de aplicar con viñetas (• o →).
4. Y — You (Cierre directo al lector):
${
  includeLeadMagnet
    ? `   Termina hablando directamente al lector invitándolo a comentar la palabra clave "${leadMagnetKeyword}" para recibir una guía, plantilla o recurso práctico por mensaje privado.`
    : `   Termina hablando directamente al lector con UNA pregunta abierta, natural y reflexiva que invite a responder desde su propia experiencia (por ejemplo: "¿Cuánto tardas normalmente en...?" o "¿Qué cambiarías tú en este paso?").
   IMPORTANTE SOBRE CTA: NO incluyas "Comenta la palabra..." ni pidas palabras clave ni prometas enviar PDFs. Cierra con una pregunta conversacional genuina.`
}

FORMATO VISUAL OBLIGATORIO (ESTILO ESCANEABLE LINKEDIN):
- Frases cortas (una idea por línea, idealmente 6–14 palabras por línea).
- Usa saltos de línea frecuentes y espacio en blanco entre bloques (jamás párrafos largos de 4+ líneas).
- Listas con símbolos simples (• o →) y ritmo rápido.
- Tono: ${tone}.
- Idioma OBLIGATORIO de salida: ${targetLangLabel}. Todo el JSON debe escribirse estrictamente en ese idioma.
- PROHIBIDO COPIAR O PLAGIAR: NUNCA copies frases literales del post de referencia, ni menciones nombres de empresas o marcas ajenas, ni enlaces externos (como lnkd.in/...), ni ofertas de empleo. Usa solo la chispa temática y redáctalo 100% original con la identidad del usuario.

RESPONDE EXCLUSIVAMENTE CON UN OBJETO JSON VÁLIDO (sin bloques de markdown ni texto extra alrededor) con la siguiente estructura según el formato solicitado:

Si format == 'text':
{
  "title": "Titular representativo corto sobre ${cleanTopic} (máx 60 caracteres)",
  "hook": "Gancho de las primeras 2 líneas (Story) que frena el scroll",
  "content": "Cuerpo completo siguiendo S-L-A-Y con frases cortas, espacio en blanco, una idea por línea y cierre Y",
  "suggestedHashtags": ["#${topicTag}", "#${cleanTopicWords[0] || 'Liderazgo'}", "#Estrategia"]
}

Si format == 'image':
{
  "title": "Titular representativo corto sobre ${cleanTopic}",
  "hook": "Gancho de las primeras 2 líneas (Story)",
  "content": "Cuerpo completo siguiendo S-L-A-Y haciendo referencia a la imagen adjunta y cierre Y",
  "imagePrompt": "Prompt en inglés hiperdetallado para Midjourney/Flux describiendo una imagen conceptual y profesional 8k relacionada directamente con ${cleanTopic}",
  "suggestedHashtags": ["#${topicTag}", "#${cleanTopicWords[0] || 'Tendencias'}", "#Estrategia"]
}

Si format == 'carousel':
{
  "title": "Titular del carrusel sobre ${cleanTopic}",
  "hook": "Gancho S-L-A-Y que invita a deslizar el carrusel",
  "content": "Copy SLAY escaneable de acompañamiento invitando a deslizar y con cierre Y",
  "slides": [
    {
      "slideNumber": 1,
      "isCover": true,
      "title": "Título de Portada de Alto Impacto sobre ${cleanTopic}",
      "subtitle": "Subtítulo explicativo con la promesa de valor",
      "content": ["Guía práctica paso a paso", "Framework SLAY"],
      "footerText": "Desliza para continuar →"
    },
    {
      "slideNumber": 2,
      "title": "La Historia y el Error Común en ${cleanTopic}",
      "content": ["Situación real frecuente", "Por qué falla el enfoque tradicional", "La lección clave"],
      "footerText": "Paso 1: Historia y Lección"
    },
    {
      "slideNumber": 3,
      "title": "Consejos Accionables",
      "content": ["Táctica 1 concreta", "Táctica 2 concreta", "Táctica 3 concreta"],
      "footerText": "Paso 2: Ejecución"
    },
    {
      "slideNumber": 4,
      "title": "Cómo Aplicarlo Hoy",
      "content": ["Regla práctica número 1", "Regla práctica número 2", "Resultado esperado"],
      "footerText": "Paso 3: Impacto"
    },
    {
      "slideNumber": 5,
      "isCta": true,
      "title": "¿Cómo lo manejas en tu equipo?",
      "subtitle": "Comparte tu perspectiva en los comentarios",
      "content": [${includeLeadMagnet ? `"Comenta ${leadMagnetKeyword} para recibir la guía", "Te la envío por mensaje directo"` : `"¿Cuál de estos pasos aplicarías primero?", "Te leo abajo"`}],
      "footerText": "Conversemos"
    }
  ]
}`;

    const userPrompt = `FORMATO SOLICITADO: ${format}
TEMA / NICHO DEL CLIENTE: ${cleanTopic}
PALABRA CLAVE DE LEAD MAGNET: ${leadMagnetKeyword}
GANCHO DE REFERENCIA A MODELAR (si existe): "${hook}"
CONTENIDO ORIGINAL DE REFERENCIA:
"${originalContent.slice(0, 2000)}"

Genera ahora el contenido modelado en JSON según las instrucciones, enfocado en el nicho de "${cleanTopic}".`;

    // 2. Ejecución con Failover Multi-Modelo de Google Gemini
    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ""
    ).trim();
    const configuredModel = (process.env.GEMINI_MODEL || "").trim();

    const candidateModels = Array.from(
      new Set(
        [
          configuredModel,
          "gemini-2.5-flash",
          "gemini-2.0-flash",
          "gemini-2.5-flash-lite",
          "gemini-flash-latest",
        ].filter(Boolean)
      )
    );

    if (apiKey) {
      for (const model of candidateModels) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 14000);

          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
                },
              ],
              generationConfig: {
                temperature: 0.65,
                responseMimeType: "application/json",
              },
            }),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (response.ok) {
            const data = await response.json();
            const rawText =
              data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

            let parsedResult;
            try {
              // Limpiar bloques de código markdown ```json si viniesen incluidos
              const cleaned = rawText
                .replace(/```json/gi, "")
                .replace(/```/g, "")
                .trim();
              parsedResult = JSON.parse(cleaned);
            } catch {
              parsedResult = null;
            }

            if (parsedResult && (parsedResult.content || parsedResult.slides)) {
              return NextResponse.json({
                success: true,
                modelUsed: model,
                engine: "gemini",
                ragIntegrated: true,
                result: parsedResult,
              });
            }
          } else {
            console.warn(
              `[Model Post API] Modelo ${model} devolvió status ${response.status}`
            );
          }
        } catch (geminiErr: any) {
          console.warn(`[Model Post API] Error en ${model}:`, geminiErr.message);
        }
      }
    }

    // 3. Generador de Respaldo RAG Inteligente (Si todas las APIs remotas fallasen o no hubiese API key)
    const fallbackResult = generateRagFallbackPost({
      format,
      topic,
      leadMagnetKeyword,
      hook,
      originalContent,
      targetLanguage: normalizedLang,
      includeLeadMagnet: Boolean(includeLeadMagnet),
    });

    return NextResponse.json({
      success: true,
      modelUsed: "rag-synthesizer",
      engine: "inhubflow-rag",
      ragIntegrated: true,
      result: fallbackResult,
    });
  } catch (error: any) {
    console.error("[Model Post AI API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Error al modelar contenido con IA" },
      { status: 500 }
    );
  }
}

/**
 * Generador sintético de contingencia universal adaptado a cualquier nicho/tema del SaaS
 */
function generateRagFallbackPost(params: {
  format: string;
  topic: string;
  leadMagnetKeyword: string;
  hook?: string;
  originalContent?: string;
  targetLanguage?: "es" | "pt" | "en";
  includeLeadMagnet?: boolean;
}) {
  const { format, topic, leadMagnetKeyword, hook, targetLanguage = "es", includeLeadMagnet = false } = params;
  const cleanTopic = (topic || "Innovación y Estrategia").trim();
  const topicTag = cleanTopic.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");
  const words = cleanTopic.split(/\s+/).filter(Boolean);
  const safeHook =
    hook && !/http|lnkd\.in|buscando\s+(un\s+)?(sdr|bdr)/i.test(hook)
      ? hook
      : targetLanguage === "pt"
      ? `Qual é o maior erro que a maioria comete em ${cleanTopic}?`
      : targetLanguage === "en"
      ? `What is the biggest mistake most teams make with ${cleanTopic}?`
      : `¿Cuál es el mayor error que comete la mayoría al trabajar en ${cleanTopic}?`;
  const cleanHook = safeHook;

  if (format === "carousel") {
    return {
      title: `Guía Maestra de ${cleanTopic}: El Framework en 4 Pasos`,
      hook: cleanHook,
      content: `${cleanHook}

La mayoría de los profesionales en ${cleanTopic} intentan resolver los problemas con métodos obsoletos que ya no funcionan hoy.

En este carrusel te revelamos el framework paso a paso para dominar ${cleanTopic} con una metodología clara, predecible y orientada a resultados reales.

Desliza para ver la guía completa.

Comenta "${leadMagnetKeyword}" abajo y te comparto el documento de trabajo completo en PDF por mensaje privado.`,
      slides: [
        {
          slideNumber: 1,
          isCover: true,
          title: `El Framework Definitivo de ${cleanTopic}`,
          subtitle: "De la frustración a resultados predecibles y de alto impacto",
          content: ["Guía paso a paso", "Metodología de Autoridad"],
          footerText: "Desliza para continuar →",
        },
        {
          slideNumber: 2,
          title: `El Gran Error en ${cleanTopic}`,
          content: [
            "Aplicar tácticas tradicionales desactualizadas",
            "No medir métricas reales de impacto y retorno",
            "Falta de consistencia y diferenciación en el mercado",
          ],
          footerText: "Paso 1: El Diagnóstico",
        },
        {
          slideNumber: 3,
          title: "El Nuevo Enfoque Estratégico",
          content: [
            "1. Diagnóstico preciso de la situación actual",
            "2. Optimización basada en datos comprobados",
            "3. Multiplicar resultados con procesos estandarizados",
          ],
          footerText: "Paso 2: La Metodología",
        },
        {
          slideNumber: 4,
          title: "Implementación en 3 Fases",
          content: [
            "Fase 1: Auditoría y corrección de fricciones",
            "Fase 2: Ejecución estructurada sin atajos",
            "Fase 3: Escala predecible y retención a largo plazo",
          ],
          footerText: "Paso 3: Ejecución",
        },
        {
          slideNumber: 5,
          isCta: true,
          title: "¿Quieres la Guía Completa en PDF?",
          subtitle: "Recibe la plantilla de trabajo lista para aplicar",
          content: [
            `Comenta "${leadMagnetKeyword}" en esta publicación`,
            "Te la enviamos directamente por mensaje privado",
          ],
          footerText: "Recurso Exclusivo",
        },
      ],
      suggestedHashtags: [`#${topicTag}`, `#${words[0] || 'Estrategia'}`, "#Innovacion", "#Liderazgo"],
    };
  }

  if (format === "image") {
    return {
      title: `El Nuevo Paradigma en ${cleanTopic}`,
      hook: cleanHook,
      content: `${cleanHook}

En el sector de ${cleanTopic}, la diferencia entre quienes lideran el mercado y quienes se quedan atrás radica en tener un método comprobado:

1. Claridad de objetivo: Identificar las palancas de mayor impacto en ${cleanTopic}.
2. Ejecución consistente: Priorizar sistemas sobre la improvisación diaria.
3. Resultados medibles: Ajustar con base en métricas reales de desempeño.

Revisa la infografía adjunta para aplicar este framework en tu día a día.

Comenta "${leadMagnetKeyword}" abajo y te comparto el recurso completo en PDF sin costo.`,
      imagePrompt: `Clean, modern visual breakdown infographic about ${cleanTopic}, minimal executive palette, high-contrast typography, crisp lighting, 8k photorealistic.`,
      suggestedHashtags: [`#${topicTag}`, `#${words[0] || 'Tendencias'}`, "#Estrategia"],
    };
  }

  // Format == 'text' (Estructura SLAY escaneable)
  if (targetLanguage === "pt") {
    const closingPt = includeLeadMagnet
      ? `Quer o guia passo a passo que usamos aqui?\nComente "${leadMagnetKeyword}" abaixo e eu envio para você por mensagem.`
      : `Qual dessas 4 ações você aplicaria primeiro na sua rotina de ${cleanTopic}?`;
    return {
      title: `SLAY: Lição prática sobre ${cleanTopic}`,
      hook: cleanHook,
      content: `${cleanHook}

Passamos semanas testando abordagens diferentes até perceber onde estávamos perdendo atenção.

A lição ficou clara:
Não é falta de esforço. É falta de contexto e método antes de agir.

O que realmente funciona na prática:
• Diagnóstico antes do pitch: entenda a dor real primeiro
• Mensagens curtas e humanas: uma ideia por linha
• Consistência semanal: ritmo vale mais que volume
• Próximo passo simples: conversa real antes da venda

${closingPt}`,
      suggestedHashtags: [`#${topicTag}`, `#${words[0] || "Estrategia"}`, "#B2B", "#Crescimento"],
    };
  }

  if (targetLanguage === "en") {
    const closingEn = includeLeadMagnet
      ? `Want the step-by-step playbook we use for this?\nComment "${leadMagnetKeyword}" below and I'll send it over.`
      : `Which of these steps do you find hardest to keep consistent in ${cleanTopic}?`;
    return {
      title: `SLAY: Practical lesson on ${cleanTopic}`,
      hook: cleanHook,
      content: `${cleanHook}

We saw smart teams burn out chasing volume until one shift changed everything.

The lesson was clear:
Speed and relevance beat brute force every single time.

What works in practice:
• Start with real context before pitching
• Keep every message short and human
• Focus on repeatable daily habits over one-off spikes
• End every interaction with a clear next question

${closingEn}`,
      suggestedHashtags: [`#${topicTag}`, `#${words[0] || "Strategy"}`, "#B2B", "#Growth"],
    };
  }

  const closingEs = includeLeadMagnet
    ? `¿Quieres la guía práctica paso a paso?\nComenta "${leadMagnetKeyword}" abajo y te la comparto por mensaje privado.`
    : `¿Cuál de estos puntos sientes que más te cuesta sostener hoy en ${cleanTopic}?`;

  return {
    title: `SLAY: Lección práctica sobre ${cleanTopic}`,
    hook: cleanHook,
    content: `${cleanHook}

Hace un tiempo vimos exactamente por qué tantos equipos pierden oportunidades valiosas cada semana.

La lección fue directa:
El resultado no depende de hacer más ruido, sino de tener un método claro y constante.

Lo que sí funciona en la práctica:
• Diagnóstico previo antes de ofrecer nada
• Mensajes breves, claros y con contexto real
• Una idea por línea para facilitar la lectura
• Seguimiento constante sin improvisación

${closingEs}`,
    suggestedHashtags: [
      `#${topicTag}`,
      `#${words[0] || 'Estrategia'}`,
      "#Liderazgo",
    ],
  };
}
