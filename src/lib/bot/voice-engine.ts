import type { BotLocale } from "@/lib/bot/i18n";

const PREFERRED_VOICE_NAMES = [
  "elena",
  "dalia",
  "paloma",
  "elvira",
  "monica",
  "paulina",
  "sabina",
  "francisca",
  "thalita",
  "raquel",
  "luciana",
  "aria",
  "jenny",
  "ava",
  "samantha",
  "karen",
];

/**
 * Cleans markdown, URLs, and emojis so browser speech synthesis reads naturally.
 */
export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[*_#`~>]+/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scores a SpeechSynthesisVoice deterministically for a target speech language
 * (e.g. "es-ES", "pt-BR", "en-US"), prioritizing Online/Natural/Google neural voices.
 */
function scoreVoice(voice: SpeechSynthesisVoice, targetLang: string): number {
  const voiceLang = (voice.lang || "").toLowerCase().replace("_", "-");
  const target = targetLang.toLowerCase().replace("_", "-");
  const baseLang = target.split("-")[0];

  if (!voiceLang.startsWith(baseLang)) {
    return -1;
  }

  let score = 0;

  if (voiceLang === target) {
    score += 300;
  } else if (
    baseLang === "es" &&
    (voiceLang === "es-mx" ||
      voiceLang === "es-419" ||
      voiceLang === "es-us" ||
      voiceLang === "es-ar" ||
      voiceLang === "es-co")
  ) {
    score += 270;
  } else {
    score += 150;
  }

  const name = (voice.name || "").toLowerCase();

  if (name.includes("online (natural)") || name.includes("natural")) {
    score += 1000;
  } else if (name.includes("google")) {
    score += 650;
  } else if (name.includes("siri") || name.includes("enhanced") || name.includes("premium")) {
    score += 550;
  } else if (name.includes("neural")) {
    score += 500;
  }

  if (!voice.localService) {
    score += 120;
  }

  if (PREFERRED_VOICE_NAMES.some((preferred) => name.includes(preferred))) {
    score += 60;
  }

  return score;
}

/**
 * Picks the highest-quality, consistent voice available in the browser for the given locale.
 */
export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  speechLang: string
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -1;

  for (const voice of voices) {
    const score = scoreVoice(voice, speechLang);
    if (score < 0) continue;

    if (
      score > bestScore ||
      (score === bestScore && bestVoice && voice.name.localeCompare(bestVoice.name) < 0)
    ) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  return bestVoice;
}

export function getVoiceLocaleHint(locale: BotLocale): string {
  if (locale === "en") return "en-US";
  if (locale === "pt-BR") return "pt-BR";
  return "es-ES";
}
