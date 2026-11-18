import type { CaptionLanguage, Transcript, TranscriptSegment, TranscriptWord } from './types'

/**
 * Words for a line of text spread over a span, weighted by length so long
 * words stay up longer. Used where the text is a translation and Whisper's
 * own word timings no longer apply.
 */
export function distributeWords(text: string, start: number, end: number): TranscriptWord[] {
  const texts = text.split(/\s+/).filter(Boolean)
  if (!texts.length) return []
  const weights = texts.map((t) => t.length + 2)
  const total = weights.reduce((a, b) => a + b, 0)
  const span = Math.max(0.1, end - start)
  let t = start
  return texts.map((word, i) => {
    const length = (span * weights[i]) / total
    const out: TranscriptWord = { text: word, start: t, end: t + length * 0.92 }
    t += length
    return out
  })
}

/** The transcript as Whisper heard it: every translated segment put back. */
export function restoreOriginal(transcript: Transcript): Transcript {
  return {
    ...transcript,
    captionLanguage: 'original',
    segments: transcript.segments.map((seg) => {
      if (!seg.original) return seg
      const { original, checkedUk: _checked, ...rest } = seg
      return { ...rest, text: original.text, words: original.words }
    })
  }
}

/**
 * Whether a recognised line may not be Ukrainian and should go to the
 * translator: Russian-only letters, mostly Latin text, or Cyrillic with none
 * of the letters only Ukrainian has (і ї є ґ), which short Russian and
 * Ukrainian lines share and only a reader can tell apart. Lines with
 * Ukrainian-only letters and no Russian-only ones are left alone.
 */
export function mayNeedUkrainian(text: string): boolean {
  if (/[ыэъёЫЭЪЁ]/.test(text)) return true
  const latin = (text.match(/[a-z]/gi) ?? []).length
  const cyrillic = (text.match(/[\u0400-\u04ff]/g) ?? []).length
  if (latin > cyrillic) return true
  if (/[іїєґІЇЄҐ]/.test(text)) return false
  return cyrillic >= 2
}

/** Segments still to send to the translator for Ukrainian captions. */
export function segmentsToTranslate(transcript: Transcript): TranscriptSegment[] {
  return transcript.segments.filter((seg) => !seg.original && !seg.checkedUk && mayNeedUkrainian(seg.text))
}

/**
 * Put the translator's answers in: a changed line shows the translation and
 * keeps what Whisper heard (so "original" can bring it back); an unchanged
 * one is marked as checked so it is not sent again.
 */
export function applyTranslations(transcript: Transcript, translations: Map<number, string>, language: CaptionLanguage): Transcript {
  const norm = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase()
  return {
    ...transcript,
    language: language === 'uk' ? 'uk' : transcript.language,
    captionLanguage: language,
    segments: transcript.segments.map((seg): TranscriptSegment => {
      const answer = translations.get(seg.id)?.trim()
      if (answer === undefined || answer === '') return seg
      if (norm(answer) === norm(seg.text)) return { ...seg, checkedUk: true }
      const original = seg.original ?? { text: seg.text, words: seg.words }
      return { ...seg, text: answer, words: distributeWords(answer, seg.start, seg.end), original }
    })
  }
}
