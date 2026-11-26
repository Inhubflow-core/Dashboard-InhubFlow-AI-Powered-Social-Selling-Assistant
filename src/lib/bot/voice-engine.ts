import type { BotLocale } from "@/lib/bot/i18n";

const PREFERRED_MALE_VOICE_NAMES = [
  "alvaro",
  "jorge",
  "tomas",
  "dario",
  "pablo",
  "raul",
  "alonso",
  "antonio",
  "daniel",
  "donato",
  "fabio",
  "julio",
  "nicolau",
  "valerio",
  "humberto",
  "guy",
  "andrew",
  "brian",
  "christopher",
  "eric",
  "steffan",
  "davis",
  "tony",
  "ryan",
  "liam",
  "george",
  "arthur",
  "male",
  "hombre",
  "masculino",
];

const KNOWN_FEMALE_VOICE_NAMES = [
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
  "helena",
  "laura",
  "maria",
  "female",
  "mujer",
  "feminino",
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
 * (e.g. "es-ES", "pt-BR", "en-US"), prioritizing Online/Natural/Google neural male voices.
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

  if (PREFERRED_MALE_VOICE_NAMES.some((preferred) => name.includes(preferred))) {
    score += 80;
  } else if (KNOWN_FEMALE_VOICE_NAMES.some((female) => name.includes(female))) {
    score -= 40;
  }

  return score;
}

/**
 * Returns all voices matching the target language sorted by quality (best first).
 */
export function listVoicesForLang(
  voices: SpeechSynthesisVoice[],
  speechLang: string
): SpeechSynthesisVoice[] {
  if (!voices || voices.length === 0) return [];
  return voices
    .map((voice) => ({ voice, score: scoreVoice(voice, speechLang) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.voice.name.localeCompare(b.voice.name)
    )
    .map((item) => item.voice);
}

/**
 * Picks the user's preferred voice if available, otherwise the highest-quality
 * consistent male neural voice available in the browser for the given locale.
 */
export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  speechLang: string,
  preferredVoiceUri?: string
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  if (preferredVoiceUri) {
    const manual = voices.find((v) => v.voiceURI === preferredVoiceUri);
    if (manual) return manual;
  }

  const ranked = listVoicesForLang(voices, speechLang);
  return ranked[0] || null;
}

export function getVoiceLocaleHint(locale: BotLocale): string {
  if (locale === "en") return "en-US";
  if (locale === "pt-BR") return "pt-BR";
  return "es-ES";
}
