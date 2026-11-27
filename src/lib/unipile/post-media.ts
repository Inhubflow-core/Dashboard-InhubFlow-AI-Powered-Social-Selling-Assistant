export interface ExtractedUnipilePostMedia {
  mediaUrl: string | null;
  mediaUrls: string[];
  documentUrl: string | null;
  documentPageCount?: number;
}

const isHttpUrl = (val: unknown): val is string =>
  typeof val === "string" && /^https?:\/\//i.test(val.trim());

/**
 * Extrae URLs reales de imágenes/diapositivas y archivo PDF/documento
 * a partir de un objeto publicación devuelto por Unipile (búsqueda o detalle).
 */
export function extractUnipilePostMedia(item: any): ExtractedUnipilePostMedia {
  const mediaUrls: string[] = [];
  const pushMediaUrl = (candidate: unknown) => {
    if (!isHttpUrl(candidate)) return;
    const trimmed = candidate.trim();
    if (!mediaUrls.includes(trimmed)) mediaUrls.push(trimmed);
  };

  let documentUrl: string | null = null;
  const setDocumentUrl = (candidate: unknown) => {
    if (documentUrl || !isHttpUrl(candidate)) return;
    documentUrl = candidate.trim();
  };

  let documentPageCount: number | undefined =
    Number(item?.document?.page_count || item?.document?.pages || 0) > 0
      ? Number(item.document.page_count || item.document.pages)
      : undefined;

  if (Array.isArray(item?.attachments) && item.attachments.length > 0) {
    for (const att of item.attachments) {
      if (typeof att === "string" && isHttpUrl(att)) {
        if (att.toLowerCase().includes(".pdf") || att.toLowerCase().includes("feedshare-document")) {
          setDocumentUrl(att);
        } else {
          pushMediaUrl(att);
        }
      } else if (att && typeof att === "object") {
        const attType = String(att.type || "").toUpperCase();
        const mime = String(att.mimetype || att.mime_type || "").toLowerCase();
        const rawDocCandidate =
          att.file_url || att.document_url || att.download_url || att.original_url || att.url || "";
        const isPdfOrDoc =
          attType === "DOCUMENT" ||
          attType === "CAROUSEL" ||
          attType === "PRESENTATION" ||
          mime.includes("pdf") ||
          String(rawDocCandidate).toLowerCase().includes(".pdf") ||
          String(rawDocCandidate).toLowerCase().includes("feedshare-document");

        const attPages = Number(att.page_count || att.pages || 0);
        if (attPages > 0 && !documentPageCount) {
          documentPageCount = attPages;
        }

        if (isPdfOrDoc) {
          setDocumentUrl(
            att.file_url || att.document_url || att.download_url || att.original_url || att.url
          );
        }

        const previewCandidates = [
          att.preview_url,
          att.thumbnail_url,
          att.cover_url,
          att.image_url,
          att.picture_url,
          att.media_url,
          att.src,
          !isPdfOrDoc ? att.url : null,
          !isPdfOrDoc ? att.file_url : null,
        ];
        for (const c of previewCandidates) {
          pushMediaUrl(c);
        }

        if (Array.isArray(att.slides)) {
          for (const slide of att.slides) {
            pushMediaUrl(slide?.image_url || slide?.url || slide?.preview_url || slide);
          }
        }
      }
    }
  }

  const directMediaCandidates = [
    item?.image_url,
    item?.media_url,
    item?.thumbnail_url,
    item?.article?.thumbnail_url,
    item?.article?.image_url,
    item?.media?.url,
    item?.document?.thumbnail_url,
    item?.document?.preview_url,
  ];
  for (const c of directMediaCandidates) {
    pushMediaUrl(c);
  }

  if (Array.isArray(item?.document?.slides)) {
    for (const slide of item.document.slides) {
      pushMediaUrl(slide?.image_url || slide?.url || slide?.preview_url || slide);
    }
  }

  if (!documentUrl) {
    setDocumentUrl(
      item?.document_url ||
        item?.document?.url ||
        item?.document?.file_url ||
        item?.document?.download_url
    );
  }

  return {
    mediaUrl: mediaUrls[0] || null,
    mediaUrls,
    documentUrl,
    documentPageCount,
  };
}
