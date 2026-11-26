import { resolveDashboardModuleInfo, type DashboardPresencePayload } from "@/lib/bot/dashboard-presence";
import { getSocialSellingDb } from "@/lib/persistence/db";
import { NextRequest, NextResponse } from "next/server";

function readPresenceRow(key: string): DashboardPresencePayload | null {
  try {
    const db = getSocialSellingDb();
    const row = db
      .prepare("SELECT payload_json, updated_at FROM workspace_settings_v2 WHERE key = ?")
      .get(key) as { payload_json?: string; updated_at?: string } | undefined;
    if (!row?.payload_json) return null;
    const parsed = JSON.parse(row.payload_json) as DashboardPresencePayload;
    return parsed?.pathname ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  const specific = userId ? readPresenceRow(`presence:${userId}`) : null;
  const latest = readPresenceRow("presence:latest");
  const presence = specific || latest;
  return NextResponse.json({
    ok: true,
    presence,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pathname = typeof body.pathname === "string" ? body.pathname.trim() : "";
    if (!pathname) {
      return NextResponse.json({ ok: false, error: "Missing pathname" }, { status: 400 });
    }

    const search = typeof body.search === "string" ? body.search.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : undefined;
    const userEmail = typeof body.userEmail === "string" ? body.userEmail.trim() : undefined;
    const userName = typeof body.userName === "string" ? body.userName.trim() : undefined;
    const visibilityState =
      typeof body.visibilityState === "string" ? body.visibilityState.trim() : "visible";

    const info = resolveDashboardModuleInfo(pathname, search);
    const nowIso = new Date().toISOString();
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    const activeTab = params.get("tab") || undefined;

    const payload: DashboardPresencePayload = {
      userId,
      userEmail,
      userName,
      pathname,
      search: search || undefined,
      fullPath: search ? `${pathname}?${search.replace(/^\?/, "")}` : pathname,
      activeTab,
      moduleKey: info.moduleKey,
      moduleLabel: info.moduleLabel,
      moduleDescription: info.moduleDescription,
      visibilityState,
      updatedAt: nowIso,
    };

    const db = getSocialSellingDb();
    const serialized = JSON.stringify(payload);
    const upsert = db.prepare(`
      INSERT INTO workspace_settings_v2 (key, updated_at, payload_json)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);

    if (userId) {
      upsert.run(`presence:${userId}`, nowIso, serialized);
    }
    upsert.run("presence:latest", nowIso, serialized);

    return NextResponse.json({ ok: true, presence: payload });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Error saving presence";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
