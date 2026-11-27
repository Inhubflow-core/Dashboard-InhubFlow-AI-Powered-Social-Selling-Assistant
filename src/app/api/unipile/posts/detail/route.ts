import { unipile } from "@/lib/unipile/client";
import { extractUnipilePostMedia } from "@/lib/unipile/post-media";
import { getStoredAccounts } from "@/lib/unipile/store";
import { NextRequest, NextResponse } from "next/server";

const isAccountHealthy = (acc: any) => {
  if (!acc) return false;
  const st = String(acc.status || "").toLowerCase();
  if (st === "ok" || st === "connected" || st === "running") return true;
  return (
    Array.isArray(acc.sources) &&
    acc.sources.some((s: any) => {
      const sSt = String(s?.status || "").toLowerCase();
      return sSt === "ok" || sSt === "connected" || sSt === "running";
    })
  );
};

/**
 * Consulta el detalle de un post específico en Unipile para recuperar URLs completas
 * de PDF/documento o diapositivas que la búsqueda general no siempre incluye.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const postId = typeof body?.postId === "string" ? body.postId.trim() : "";
    const socialId = typeof body?.socialId === "string" ? body.socialId.trim() : "";
    const requestedAccountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";

    if (!postId && !socialId) {
      return NextResponse.json({ error: "postId requerido" }, { status: 400 });
    }

    let targetAccountId = process.env.UNIPILE_SCANNER_ACCOUNT_ID?.trim() || requestedAccountId;

    try {
      const res = await unipile.listAccounts();
      const liveAccounts = res.items || [];
      const selected = liveAccounts.find((a) => a.id === targetAccountId);
      if (!selected || !isAccountHealthy(selected)) {
        const healthy = liveAccounts.find(isAccountHealthy);
        if (healthy) targetAccountId = healthy.id;
      }
    } catch {
      // Fallback a cuentas locales abajo
    }

    if (!targetAccountId) {
      const stored = getStoredAccounts();
      const healthyStored = stored.find((a) => a.status === "OK");
      if (healthyStored) targetAccountId = healthyStored.id;
    }

    if (!targetAccountId) {
      return NextResponse.json(
        { success: false, documentUrl: null, mediaUrl: null, mediaUrls: [] },
        { status: 200 }
      );
    }

    let rawPost = postId ? await unipile.getPost(postId, targetAccountId) : null;
    if (!rawPost && socialId && socialId !== postId) {
      rawPost = await unipile.getPost(socialId, targetAccountId);
    }

    if (!rawPost) {
      return NextResponse.json(
        { success: false, documentUrl: null, mediaUrl: null, mediaUrls: [] },
        { status: 200 }
      );
    }

    const extracted = extractUnipilePostMedia(rawPost);
    return NextResponse.json({
      success: Boolean(extracted.documentUrl || extracted.mediaUrls.length > 0),
      ...extracted,
    });
  } catch (error: any) {
    console.warn("[Posts Detail] Error obteniendo detalle:", error?.message || error);
    return NextResponse.json(
      { success: false, documentUrl: null, mediaUrl: null, mediaUrls: [] },
      { status: 200 }
    );
  }
}
