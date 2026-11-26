import { executeScheduledDispatch, type SchedulablePost } from "@/lib/viral-posts/scheduler";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const result = await executeScheduledDispatch([]);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Run Scheduled Posts GET] Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Error al ejecutar publicaciones programadas." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const duePosts: SchedulablePost[] = Array.isArray(body.duePosts) ? body.duePosts : [];
    const result = await executeScheduledDispatch(duePosts);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Run Scheduled Posts POST] Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Error al ejecutar publicaciones programadas." },
      { status: 500 }
    );
  }
}
