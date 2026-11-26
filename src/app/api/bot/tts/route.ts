import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { getBotLocale } from "@/lib/bot/i18n";
import { cleanTextForSpeech, resolveNeuralVoiceId } from "@/lib/bot/voice-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let tts: MsEdgeTTS | null = null;
  try {
    const body = await req.json();
    const rawText = typeof body?.text === "string" ? body.text : "";
    const locale = getBotLocale(typeof body?.locale === "string" ? body.locale : undefined);
    const voiceId = resolveNeuralVoiceId(
      locale,
      typeof body?.voiceId === "string" ? body.voiceId : undefined
    );

    const clean = cleanTextForSpeech(rawText).slice(0, 800);
    if (!clean) {
      return NextResponse.json({ error: "Empty text" }, { status: 400 });
    }

    tts = new MsEdgeTTS();
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(clean);
    const chunks: Buffer[] = [];

    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const audioBuffer = Buffer.concat(chunks);
    if (audioBuffer.length === 0) {
      return NextResponse.json({ error: "Empty audio stream" }, { status: 502 });
    }

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[API /bot/tts] Error synthesizing speech:", err);
    return NextResponse.json({ error: "TTS synthesis failed" }, { status: 500 });
  } finally {
    try {
      tts?.close();
    } catch {}
  }
}
