/**
 * Which language the AI should write viewer-facing text in (clip titles,
 * on-screen hooks, summaries, hashtags, post captions).
 *
 * The prompts themselves are English, so without an explicit instruction
 * models answer in English even when the speaker talks Ukrainian. The
 * transcript's language is the right target: the clip is published to the
 * same audience that understands the speaker.
 */

/** Whisper language codes (and the full names some backends return) → English name. */
const LANGUAGE_NAMES: Record<string, string> = {
  uk: 'Ukrainian',
  ukrainian: 'Ukrainian',
  en: 'English',
  english: 'English',
  pl: 'Polish',
  polish: 'Polish',
  de: 'German',
  german: 'German',
  es: 'Spanish',
  spanish: 'Spanish',
  fr: 'French',
  french: 'French',
  it: 'Italian',
  italian: 'Italian',
  pt: 'Portuguese',
  portuguese: 'Portuguese'
}

/** English name of a transcript language, or null when it is unknown. */
export function languageName(code: string | null | undefined): string | null {
  const key = (code ?? '').trim().toLowerCase()
  if (!key || key === 'auto') return null
  return LANGUAGE_NAMES[key] ?? null
}

/**
 * One prompt line telling the model which language to write viewer-facing
 * fields in. Falls back to "the language of the transcript" when the code is
 * unknown, which still stops the model defaulting to English.
 */
export function outputLanguageInstruction(code: string | null | undefined, fields: string): string {
  const name = languageName(code)
  const target = name ? `${name} (the language the speaker uses)` : 'the same language the speaker uses in the transcript'
  return `Write ${fields} in ${target}, even though these instructions are in English. Hashtags too: use words in that language, not English translations.`
}

/**
 * Prompt line for analysis steps whose free-text fields are shown to the
 * creator (reasons, concerns, summaries). Structural values and verbatim
 * quotes stay as they are, because code validates them against the source.
 */
export function creatorTextInstruction(code: string | null | undefined, fields: string): string {
  const name = languageName(code)
  const target = name ?? 'the same language the speaker uses in the transcript'
  return `Write ${fields} in ${target} — they are shown to the creator. Keep JSON keys, enum values, ids and any exact transcript quotes unchanged.`
}
