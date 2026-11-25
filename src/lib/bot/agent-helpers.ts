import { getSocialSellingDb } from "@/lib/persistence/db";
import { INITIAL_KNOWLEDGE_SOURCES } from "@/lib/sdr/knowledge-data";
import type { KnowledgeSource } from "@/lib/sdr/types";
import { unipile } from "@/lib/unipile/client";
import { getStoredAccounts } from "@/lib/unipile/store";
import type { UnipilePostItem, UnipileProfile, UnipileSearchPerson } from "@/lib/unipile/types";

export interface VerifiedPersonCandidate {
  providerId: string;
  publicIdentifier?: string;
  name: string;
  headline: string;
  company?: string;
  location?: string;
  pictureUrl?: string;
  profileUrl?: string;
  networkDistance: "FIRST_DEGREE" | "SECOND_DEGREE" | "THIRD_DEGREE" | "OUT_OF_NETWORK" | "UNKNOWN";
  pendingInvitation?: boolean;
}

export interface ApprovalActionPayload {
  type: "post" | "connection" | "comment" | "message";
  preview: string;
  title?: string;
  targetName?: string;
  targetHeadline?: string;
  targetProviderId?: string;
  targetPublicIdentifier?: string;
  targetProfileUrl?: string;
  targetPostId?: string;
  targetPostSnippet?: string;
  networkDistance?: string;
  scheduledAt?: string;
}

/**
 * Lee los documentos aprobados de la Base de Conocimiento (SQLite sdr_state_v2)
 * con fallback a los documentos base del sistema.
 */
export function getApprovedKnowledgeContext(): {
  hasCustomKnowledge: boolean;
  companyName: string | null;
  contextText: string;
} {
  let docs: KnowledgeSource[] = [];
  try {
    const db = getSocialSellingDb();
    const row = db
      .prepare("SELECT payload_json FROM sdr_state_v2 WHERE key = 'knowledge'")
      .get() as { payload_json: string } | undefined;

    if (row?.payload_json) {
      const parsed = JSON.parse(row.payload_json);
      if (Array.isArray(parsed)) {
        docs = parsed;
      }
    }
  } catch {}

  const approved = docs.filter((d) => d && d.status === "approved");
  const customDocs = approved.filter(
    (d) =>
      String(d.id || "").startsWith("kb-copilot-") ||
      String(d.id || "").startsWith("kb-custom-") ||
      !["kb-01", "kb-02", "kb-03", "kb-04", "kb-05"].includes(String(d.id || ""))
  );

  const effectiveDocs = approved.length > 0 ? approved : INITIAL_KNOWLEDGE_SOURCES;
  let companyName: string | null = null;
  const companyDoc = customDocs.find((d) => d.category === "company") || customDocs[0];
  if (companyDoc?.title) {
    const m = companyDoc.title.match(/:\s*(.+)$/);
    companyName = m ? m[1].trim() : companyDoc.title;
  }

  const contextText = effectiveDocs
    .map(
      (d) =>
        `### [${(d.category || "COMPANY").toUpperCase()}] ${d.title}\n${String(d.content || "").trim()}`
    )
    .join("\n\n")
    .slice(0, 8000);

  return {
    hasCustomKnowledge: customDocs.length > 0,
    companyName,
    contextText,
  };
}

function isAccountHealthy(acc: { status?: string; sources?: Array<{ status?: string }> }): boolean {
  if (!acc) return false;
  const st = String(acc.status || "").toUpperCase();
  if (st === "OK" || st === "CONNECTED" || st === "ACTIVE" || st === "RUNNING") return true;
  if (
    Array.isArray(acc.sources) &&
    acc.sources.some((s) => {
      const sst = String(s?.status || "").toUpperCase();
      return sst === "OK" || sst === "CONNECTED" || sst === "RUNNING";
    })
  ) {
    return true;
  }
  return false;
}

function cleanUnipileId(id?: string): string {
  return (id || "").replace(/^acc-li-/, "").trim();
}

/**
 * Resuelve la cuenta de LinkedIn activa en Unipile o en almacenamiento local.
 */
export async function resolveActiveLinkedInAccount(): Promise<{
  accountId: string | null;
  accountName: string;
  isSandbox: boolean;
}> {
  if (unipile.isConfigured()) {
    try {
      const res = await unipile.listAccounts();
      const linkedinAccounts = (res.items || []).filter(
        (a) => String(a.type || a.provider || "LINKEDIN").toUpperCase() === "LINKEDIN"
      );
      const healthy = linkedinAccounts.find(isAccountHealthy) || linkedinAccounts[0];
      if (healthy?.id) {
        return {
          accountId: cleanUnipileId(healthy.id),
          accountName: healthy.name || "LinkedIn",
          isSandbox: false,
        };
      }
    } catch (err) {
      console.warn("[Bot Agent] Error listando cuentas Unipile:", err);
    }
  }

  try {
    const db = getSocialSellingDb();
    const rows = db
      .prepare("SELECT id, name, status, payload_json FROM linkedin_accounts_v2 ORDER BY updated_at DESC")
      .all() as Array<{ id: string; name: string; status: string; payload_json: string }>;

    for (const r of rows) {
      let unipileId = r.id;
      let status = r.status;
      try {
        const p = JSON.parse(r.payload_json);
        if (p?.unipileAccountId) unipileId = String(p.unipileAccountId);
        if (p?.status) status = String(p.status);
      } catch {}
      if (isAccountHealthy({ status })) {
        return {
          accountId: cleanUnipileId(unipileId),
          accountName: r.name || "LinkedIn",
          isSandbox: unipile.isSandboxMode(),
        };
      }
    }
  } catch {}

  const stored = getStoredAccounts();
  const healthyStored = stored.find((a) => a.status === "OK") || stored[0];
  if (healthyStored) {
    return {
      accountId: cleanUnipileId(healthyStored.unipileAccountId || healthyStored.id),
      accountName: healthyStored.name || "LinkedIn",
      isSandbox: unipile.isSandboxMode(),
    };
  }

  return {
    accountId: null,
    accountName: "LinkedIn",
    isSandbox: unipile.isSandboxMode(),
  };
}

export function getCandidateGeminiModels(): string[] {
  const configured = (process.env.GEMINI_MODEL || "").trim();
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return Array.from(
    new Set(
      [
        configured,
        ...fallbacks,
        "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-2.0-flash",
      ].filter(Boolean)
    )
  );
}

export interface GeminiPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
}

export interface GeminiTurn {
  role: "user" | "model";
  parts: GeminiPart[];
}

/**
 * Invoca Google Gemini (texto y/o visión multimodal con inline_data) con failover automático.
 */
export async function callGeminiMultimodal(params: {
  systemPrompt: string;
  turns: GeminiTurn[];
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}): Promise<{ ok: boolean; text: string; modelUsed?: string }> {
  const geminiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  ).trim();

  if (!geminiKey) {
    return { ok: false, text: "" };
  }

  const candidateModels = getCandidateGeminiModels();
  for (const model of candidateModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 16000);
      const generationConfig: Record<string, unknown> = {
        temperature: params.temperature ?? 0.65,
        maxOutputTokens: params.maxOutputTokens ?? 1100,
      };
      if (params.jsonMode) {
        generationConfig.responseMimeType = "application/json";
      }

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: params.systemPrompt }] },
            contents: params.turns,
            generationConfig,
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (aiText) {
          return { ok: true, text: aiText, modelUsed: model };
        }
      }
    } catch {
      // Try next fallback model
    }
  }

  return { ok: false, text: "" };
}

function normalizeNetworkDistance(
  raw?: string | null,
  isRelationship?: boolean
): VerifiedPersonCandidate["networkDistance"] {
  if (isRelationship) return "FIRST_DEGREE";
  const val = String(raw || "").toUpperCase();
  if (val.includes("FIRST") || val === "1" || val === "1ST") return "FIRST_DEGREE";
  if (val.includes("SECOND") || val === "2" || val === "2ND") return "SECOND_DEGREE";
  if (val.includes("THIRD") || val === "3" || val === "3RD") return "THIRD_DEGREE";
  if (val.includes("OUT")) return "OUT_OF_NETWORK";
  return "UNKNOWN";
}

function proxyLinkedInImage(url?: string | null): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return undefined;
  return `/api/proxy-image?url=${encodeURIComponent(trimmed)}`;
}

/**
 * Busca personas en LinkedIn vía Unipile y devuelve candidatos con foto de perfil
 * y nivel de conexión para verificación humana antes de actuar.
 */
export async function searchLinkedInPeopleForVerification(
  query: string
): Promise<{
  ok: boolean;
  accountId: string | null;
  candidates: VerifiedPersonCandidate[];
  error?: string;
}> {
  const { accountId } = await resolveActiveLinkedInAccount();
  if (!accountId) {
    return {
      ok: false,
      accountId: null,
      candidates: [],
      error: "No tienes una cuenta de LinkedIn conectada y activa en este momento.",
    };
  }

  // Si pasaron URL directa de LinkedIn (/in/slug), resolver directo
  const urlMatch = query.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (urlMatch?.[1] && unipile.isConfigured()) {
    try {
      const profile: UnipileProfile = await unipile.resolveProfile(urlMatch[1], accountId);
      const fullName =
        [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
        urlMatch[1];
      return {
        ok: true,
        accountId,
        candidates: [
          {
            providerId: profile.provider_id || profile.member_urn || urlMatch[1],
            publicIdentifier: profile.public_identifier || urlMatch[1],
            name: fullName,
            headline: profile.headline || "Profesional en LinkedIn",
            company: profile.work_experience?.[0]?.company || undefined,
            location: profile.location || undefined,
            pictureUrl: proxyLinkedInImage(
              profile.profile_picture_url_large || profile.profile_picture_url || profile.picture_url
            ),
            profileUrl:
              profile.public_profile_url ||
              profile.profile_url ||
              `https://www.linkedin.com/in/${urlMatch[1]}/`,
            networkDistance: normalizeNetworkDistance(
              profile.network_distance,
              profile.is_relationship
            ),
            pendingInvitation: profile.invitation?.status === "PENDING",
          },
        ],
      };
    } catch {}
  }

  // Búsqueda estándar en Unipile (si no está configurado, revisar leads locales en CRM)
  if (unipile.isConfigured()) {
    try {
      const searchRes = await unipile.searchLinkedIn({
        account_id: accountId,
        category: "people",
        keywords: query,
        limit: 5,
      });

      const rawPeople = (searchRes.items || []) as UnipileSearchPerson[];
      const candidates: VerifiedPersonCandidate[] = [];

      for (const p of rawPeople.slice(0, 4)) {
        if (!p || (!p.name && !p.first_name)) continue;
        const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
        let picture = p.profile_picture_url;
        let networkDistance = normalizeNetworkDistance(p.network_distance);
        let headline = p.headline || "Profesional en LinkedIn";
        let location = p.location;
        let company = p.current_positions?.[0]?.company || undefined;
        const identifier = p.public_identifier || p.id;

        // Enriquecer primer candidato si falta foto o grado de conexión
        if (candidates.length === 0 && identifier && (networkDistance === "UNKNOWN" || !picture)) {
          try {
            const prof = await Promise.race([
              unipile.resolveProfile(identifier, accountId),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2800)),
            ]);
            if (prof) {
              picture =
                prof.profile_picture_url_large || prof.profile_picture_url || prof.picture_url || picture;
              networkDistance = normalizeNetworkDistance(prof.network_distance, prof.is_relationship);
              headline = prof.headline || headline;
              location = prof.location || location;
              company = prof.work_experience?.[0]?.company || company;
            }
          } catch {}
        }

        candidates.push({
          providerId: p.id || p.member_urn || identifier,
          publicIdentifier: p.public_identifier,
          name,
          headline,
          company,
          location,
          pictureUrl: proxyLinkedInImage(picture),
          profileUrl:
            p.public_profile_url ||
            p.profile_url ||
            (p.public_identifier ? `https://www.linkedin.com/in/${p.public_identifier}/` : undefined),
          networkDistance,
          pendingInvitation: Boolean(p.pending_invitation),
        });
      }

      if (candidates.length > 0) {
        return { ok: true, accountId, candidates };
      }
    } catch (err) {
      console.warn("[Bot Agent] Error en searchLinkedIn people:", err);
    }
  }

  // Fallback: buscar en CRM local si no devolvió resultados en vivo
  try {
    const db = getSocialSellingDb();
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    const rows = db
      .prepare("SELECT * FROM crm_leads_360 ORDER BY created_at DESC LIMIT 40")
      .all() as Array<{
      id: string;
      full_name: string;
      linkedin_url?: string;
      stage?: string;
      metadata_json?: string;
    }>;

    const matched: VerifiedPersonCandidate[] = [];
    for (const r of rows) {
      let meta: Record<string, unknown> = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch {}
      const haystack = `${r.full_name} ${String(meta.headline || "")} ${String(meta.company || "")}`.toLowerCase();
      if (tokens.some((t) => haystack.includes(t))) {
        const isConnected = r.stage === "connected" || r.stage === "engaged" || r.stage === "meeting_booked";
        matched.push({
          providerId: String(meta.providerId || r.id),
          publicIdentifier: String(meta.publicIdentifier || "") || undefined,
          name: r.full_name,
          headline: String(meta.headline || meta.title || "Contacto en CRM InhubFlow"),
          company: meta.company ? String(meta.company) : undefined,
          location: meta.location ? String(meta.location) : undefined,
          pictureUrl: proxyLinkedInImage(meta.avatarUrl ? String(meta.avatarUrl) : undefined),
          profileUrl: r.linkedin_url || undefined,
          networkDistance: isConnected ? "FIRST_DEGREE" : "SECOND_DEGREE",
        });
      }
    }
    if (matched.length > 0) {
      return { ok: true, accountId, candidates: matched.slice(0, 4) };
    }
  } catch {}

  return {
    ok: true,
    accountId,
    candidates: [],
  };
}

/**
 * Obtiene la publicación más reciente de un perfil de LinkedIn vía Unipile.
 */
export async function getLatestPostOfPerson(
  identifier: string,
  accountId: string
): Promise<UnipilePostItem | null> {
  try {
    const posts = await unipile.getUserPosts({
      account_id: accountId,
      identifier,
      limit: 3,
    });
    return posts[0] || null;
  } catch {
    return null;
  }
}

/**
 * Ejecuta en LinkedIn / SQLite una acción previamente aprobada por el usuario.
 */
export async function executeApprovedAction(
  approval: ApprovalActionPayload,
  scheduledAtOverride?: string
): Promise<{
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}> {
  const { accountId, accountName } = await resolveActiveLinkedInAccount();
  const db = getSocialSellingDb();
  const effectiveSchedule = scheduledAtOverride || approval.scheduledAt;

  // 1. PUBLICAR O PROGRAMAR POST
  if (approval.type === "post") {
    const text = (approval.preview || "").trim();
    if (!text) {
      return { ok: false, message: "El contenido del post está vacío." };
    }

    const id = `post-${Date.now()}`;
    const now = new Date().toISOString();
    const title = approval.title || text.split("\n")[0]?.slice(0, 60) || "Post de LinkedIn";

    if (effectiveSchedule) {
      db.prepare(
        `INSERT INTO viral_posts (
          id, workspace_id, title, format, content, status, scheduled_at, target_account_id,
          created_at, lead_magnet_keyword, auto_dm_enabled, auto_dm_message, auto_like_comment, metadata_json
        ) VALUES (?, 'default', ?, 'text', ?, 'scheduled', ?, ?, ?, 'SISTEMA', 0, '', 0, ?)`
      ).run(
        id,
        title,
        text,
        effectiveSchedule,
        accountId || null,
        now,
        JSON.stringify({ source: "inhub_bot" })
      );

      return {
        ok: true,
        message: `Publicación **programada** en tu calendario editorial para el **${new Date(
          effectiveSchedule
        ).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}**.`,
        details: { id, status: "scheduled", scheduledAt: effectiveSchedule },
      };
    }

    if (!accountId) {
      return {
        ok: false,
        message: "No hay ninguna cuenta de LinkedIn conectada y activa para publicar.",
      };
    }

    const result = await unipile.createPost({
      account_id: accountId,
      text,
    });
    const linkedinPostId = result.post_id || result.id || `up_post_${Date.now()}`;

    db.prepare(
      `INSERT INTO viral_posts (
        id, workspace_id, title, format, content, status, published_at, linkedin_post_id, target_account_id,
        created_at, lead_magnet_keyword, auto_dm_enabled, auto_dm_message, auto_like_comment, metadata_json
      ) VALUES (?, 'default', ?, 'text', ?, 'published', ?, ?, ?, ?, 'SISTEMA', 0, '', 0, ?)`
    ).run(
      id,
      title,
      text,
      now,
      linkedinPostId,
      accountId,
      now,
      JSON.stringify({ source: "inhub_bot" })
    );

    return {
      ok: true,
      message: `Publicación **emitida en vivo en LinkedIn** desde la cuenta **${accountName}**.`,
      details: { id, linkedinPostId, status: "published" },
    };
  }

  if (!accountId) {
    return {
      ok: false,
      message: "No hay una cuenta de LinkedIn activa conectada para ejecutar esta acción.",
    };
  }

  // 2. SOLICITUD DE CONEXIÓN
  if (approval.type === "connection") {
    if (!approval.targetProviderId) {
      return {
        ok: false,
        message: "Falta identificar el perfil del destinatario antes de enviar la invitación.",
      };
    }
    const res = await unipile.sendInvitation({
      account_id: accountId,
      provider_id: approval.targetProviderId,
      message: approval.preview?.slice(0, 290) || undefined,
    });

    return {
      ok: true,
      message: `Solicitud de conexión enviada a **${approval.targetName || "el prospecto"}** vía **${accountName}**.`,
      details: { invitationId: res.invitation_id, status: res.status || "sent" },
    };
  }

  // 3. COMENTARIO EN POST
  if (approval.type === "comment") {
    if (!approval.targetPostId) {
      return {
        ok: false,
        message: "No se encontró el ID de la publicación a comentar.",
      };
    }
    const res = await unipile.commentOnPost({
      account_id: accountId,
      post_id: approval.targetPostId,
      text: approval.preview.trim(),
    });

    return {
      ok: true,
      message: `Comentario publicado en la última publicación de **${approval.targetName || "el prospecto"}**.`,
      details: { commentId: res.comment_id || res.id },
    };
  }

  // 4. MENSAJE DIRECTO / PROPUESTA
  if (approval.type === "message") {
    const text = (approval.preview || "").trim();
    if (!text) {
      return { ok: false, message: "El texto del mensaje está vacío." };
    }

    // Buscar si ya existe un chat con esta persona
    let existingChatId: string | null = null;
    if (approval.targetName || approval.targetProviderId) {
      try {
        const chats = await unipile.listChats(accountId, 40);
        const normName = (approval.targetName || "").toLowerCase().trim();
        for (const c of chats.items || []) {
          if (
            (approval.targetProviderId && c.attendee_provider_id === approval.targetProviderId) ||
            (normName && c.name && c.name.toLowerCase().includes(normName))
          ) {
            existingChatId = c.id;
            break;
          }
        }
      } catch {}
    }

    if (existingChatId) {
      const sent = await unipile.sendMessage({
        chat_id: existingChatId,
        text,
      });
      return {
        ok: true,
        message: `Mensaje enviado a **${approval.targetName || "el prospecto"}** en su chat de LinkedIn.`,
        details: { chatId: existingChatId, messageId: sent.message_id },
      };
    }

    if (!approval.targetProviderId) {
      return {
        ok: false,
        message: "Falta el ID del perfil en LinkedIn para iniciar el chat.",
      };
    }

    const started = await unipile.startChat({
      account_id: accountId,
      attendees_ids: [approval.targetProviderId],
      text,
    });
    return {
      ok: true,
      message: `Mensaje / propuesta enviado a **${approval.targetName || "el prospecto"}** en LinkedIn.`,
      details: { chatId: started.chat_id, messageId: started.message_id },
    };
  }

  return { ok: false, message: "Tipo de acción no soportado." };
}
