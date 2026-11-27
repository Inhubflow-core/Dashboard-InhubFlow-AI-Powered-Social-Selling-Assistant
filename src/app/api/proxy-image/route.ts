import { NextRequest, NextResponse } from "next/server";

function isDisallowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const inlinePdfRequested = req.nextUrl.searchParams.get("inline") === "1";

  if (!url) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse("Invalid url parameter", { status: 400 });
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || isDisallowedHost(parsed.hostname)) {
    return new NextResponse("Disallowed target url", { status: 403 });
  }

  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) InhubFlow/1.0",
        Referer: "https://www.linkedin.com/",
      },
    });

    if (!res.ok) {
      return new NextResponse(`Failed to fetch asset: ${res.statusText}`, {
        status: res.status,
      });
    }

    const rawContentType = (res.headers.get("content-type") || "").toLowerCase();
    const arrayBuffer = await res.arrayBuffer();
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
    const hasPdfMagic =
      headerBytes.length >= 4 &&
      headerBytes[0] === 0x25 && // %
      headerBytes[1] === 0x50 && // P
      headerBytes[2] === 0x44 && // D
      headerBytes[3] === 0x46;   // F

    const lowerUrl = parsed.toString().toLowerCase();
    const isPdf =
      hasPdfMagic ||
      rawContentType.includes("application/pdf") ||
      (inlinePdfRequested && (rawContentType.includes("octet-stream") || !rawContentType)) ||
      lowerUrl.includes(".pdf") ||
      lowerUrl.includes("feedshare-document");

    const finalContentType = isPdf ? "application/pdf" : rawContentType || "image/png";

    const headers: Record<string, string> = {
      "Content-Type": finalContentType,
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    if (isPdf) {
      // Fuerza renderizado inline dentro de <iframe> en lugar de descarga automática
      headers["Content-Disposition"] = 'inline; filename="linkedin-document.pdf"';
    }

    return new NextResponse(arrayBuffer, { headers });
  } catch (error: any) {
    return new NextResponse(error.message || "Failed to proxy asset", { status: 500 });
  }
}
