import { getSocialSellingDb } from "@/lib/persistence/db";
import { unipile } from "@/lib/unipile/client";
import { getStoredAccounts } from "@/lib/unipile/store";

export interface SchedulablePost {
  id: string;
  title?: string;
  format?: string;
  content: string;
  targetAccountId?: string;
  scheduledAt?: string;
  carouselPdfUrl?: string;
  coverImage?: string;
  mediaUrl?: string;
}

export interface ScheduledDispatchResult {
  ok: boolean;
  processed: number;
  published: Array<{ id: string; linkedinPostId: string; publishedAt: string }>;
  failed: Array<{ id: string; error: string }>;
  skippedBecauseBusy?: boolean;
}

const globalScheduler = globalThis as typeof globalThis & {
  __inhubViralSchedulerStarted?: boolean;
  __inhubScheduledDispatchRunning?: boolean;
};

function isAccountHealthy(acc: any): boolean {
  if (!acc) return false;
  if (acc.status === "OK" || acc.status === "CONNECTED") return true;
  if (Array.isArray(acc.sources) && acc.sources.some((s: any) => s.status === "OK" || s.status === "CONNECTED")) {
    return true;
  }
  return false;
}

function cleanUnipileId(id?: string): string {
  return (id || "").replace(/^acc-li-/, "");
}

async function resolveHealthyAccountId(
  requestedAccountId: string | undefined,
  liveAccounts: any[]
): Promise<string> {
  let targetAccountId = cleanUnipileId(requestedAccountId);
  let selectedAccountObj = liveAccounts.find((a) => cleanUnipileId(a.id) === targetAccountId);

  if (!selectedAccountObj || !isAccountHealthy(selectedAccountObj)) {
    const healthyLive = liveAccounts.find(isAccountHealthy);
    if (healthyLive) {
      targetAccountId = cleanUnipileId(healthyLive.id);
      selectedAccountObj = healthyLive;
    }
  }

  if (!targetAccountId) {
    const stored = getStoredAccounts();
    const healthyStored = stored.find((a) => a.status === "OK");
    if (healthyStored) {
      targetAccountId = cleanUnipileId(healthyStored.unipileAccountId || healthyStored.id);
    }
  }

  return targetAccountId;
}

function buildPostAttachments(post: SchedulablePost) {
  if (post.format === "carousel" && post.carouselPdfUrl) {
    return [
      {
        content: post.carouselPdfUrl,
        filename: "carrusel.pdf",
        content_type: "application/pdf",
      },
    ];
  }

  const imageSrc = post.coverImage || post.mediaUrl;
  if (imageSrc && imageSrc.startsWith("data:")) {
    return [
      {
        content: imageSrc,
        filename: "post-cover.png",
        content_type: "image/png",
      },
    ];
  }

  return undefined;
}

/**
 * Ejecuta el despacho de publicaciones programadas cuya fecha y hora (`scheduledAt`) ya venció.
 * Protegido por lock en memoria para evitar envíos duplicados entre el cron interno y peticiones HTTP.
 */
export async function executeScheduledDispatch(
  clientDuePosts: SchedulablePost[] = []
): Promise<ScheduledDispatchResult> {
  if (globalScheduler.__inhubScheduledDispatchRunning) {
    return {
      ok: true,
      processed: 0,
      published: [],
      failed: [],
      skippedBecauseBusy: true,
    };
  }

  globalScheduler.__inhubScheduledDispatchRunning = true;
  try {
    const nowIso = new Date().toISOString();
    const db = getSocialSellingDb();

    const dbDueRows = db
      .prepare(
        `SELECT * FROM viral_posts
         WHERE status = 'scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= ?`
      )
      .all(nowIso) as any[];

    const mergedById = new Map<string, SchedulablePost>();

    for (const row of dbDueRows) {
      let metadata: Record<string, any> = {};
      try {
        metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      } catch {
        metadata = {};
      }
      mergedById.set(row.id, {
        id: row.id,
        title: row.title,
        format: row.format,
        content: row.content,
        targetAccountId: row.target_account_id || undefined,
        scheduledAt: row.scheduled_at,
        carouselPdfUrl: metadata.carouselPdfUrl,
        coverImage: metadata.coverImage,
        mediaUrl: metadata.mediaUrl,
      });
    }

    for (const post of clientDuePosts) {
      if (!post || !post.id || !post.content?.trim()) continue;
      if (post.scheduledAt && post.scheduledAt > nowIso) continue;
      const existingRow = db.prepare("SELECT status FROM viral_posts WHERE id = ?").get(post.id) as
        | { status?: string }
        | undefined;
      if (existingRow?.status === "published") continue;

      const prev = mergedById.get(post.id);
      mergedById.set(post.id, {
        ...(prev || {}),
        ...post,
      });
    }

    const postsToRun = Array.from(mergedById.values());
    if (postsToRun.length === 0) {
      return { ok: true, processed: 0, published: [], failed: [] };
    }

    if (!unipile.isConfigured()) {
      return {
        ok: true,
        processed: postsToRun.length,
        published: [],
        failed: postsToRun.map((p) => ({
          id: p.id,
          error: "Unipile no configurado en este entorno.",
        })),
      };
    }

    let liveAccounts: any[] = [];
    try {
      const res = await unipile.listAccounts();
      liveAccounts = res.items || [];
    } catch (err) {
      console.warn("[Run Scheduled Posts] Error consultando cuentas Unipile:", err);
    }

    const checkStatusStmt = db.prepare("SELECT status FROM viral_posts WHERE id = ?");
    const updateStmt = db.prepare(`
      UPDATE viral_posts
      SET status = 'published',
          published_at = ?,
          linkedin_post_id = ?
      WHERE id = ?
    `);

    const published: Array<{ id: string; linkedinPostId: string; publishedAt: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const post of postsToRun) {
      try {
        // Re-verificar en SQLite que no haya sido publicado en paralelo
        const currentRow = checkStatusStmt.get(post.id) as { status?: string } | undefined;
        if (currentRow?.status === "published") continue;

        if (!post.content || !post.content.trim()) {
          failed.push({ id: post.id, error: "Contenido vacío" });
          continue;
        }

        const accountId = await resolveHealthyAccountId(post.targetAccountId, liveAccounts);
        if (!accountId) {
          failed.push({ id: post.id, error: "No hay una cuenta de LinkedIn conectada (OK)." });
          continue;
        }

        const attachments = buildPostAttachments(post);
        const result = await unipile.createPost({
          account_id: accountId,
          text: post.content.trim(),
          attachments,
        });

        const linkedinPostId = result.post_id || result.id || `up_post_${Date.now()}`;
        const publishedAt = new Date().toISOString();

        updateStmt.run(publishedAt, linkedinPostId, post.id);
        published.push({ id: post.id, linkedinPostId, publishedAt });
      } catch (err: any) {
        console.error(`[Run Scheduled Posts] Error publicando ${post.id}:`, err);
        failed.push({ id: post.id, error: err?.message || "Error desconocido al publicar" });
      }
    }

    return {
      ok: true,
      processed: postsToRun.length,
      published,
      failed,
    };
  } finally {
    globalScheduler.__inhubScheduledDispatchRunning = false;
  }
}

/**
 * Inicia el scheduler autónomo 24/7 en el servidor Node.js (ideal para Coolify / Docker).
 * Revisa cada 2 minutos las publicaciones programadas en SQLite y las publica sin depender del navegador.
 */
export function startViralPostsScheduler(): void {
  if (globalScheduler.__inhubViralSchedulerStarted) return;
  globalScheduler.__inhubViralSchedulerStarted = true;

  const INTERVAL_MS = 2 * 60 * 1000;
  const INITIAL_DELAY_MS = 15 * 1000;

  const tick = async () => {
    try {
      const result = await executeScheduledDispatch([]);
      if (result.published.length > 0) {
        console.log(
          `[ViralPosts Scheduler] Publicados automáticamente ${result.published.length} post(s) programados.`
        );
      }
    } catch (err) {
      console.warn("[ViralPosts Scheduler] Error en ciclo programado:", err);
    }
  };

  setTimeout(() => {
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, INTERVAL_MS);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }, INITIAL_DELAY_MS);

  console.log("[ViralPosts Scheduler] Cron interno 24/7 activado (revisión cada 2 minutos).");
}
