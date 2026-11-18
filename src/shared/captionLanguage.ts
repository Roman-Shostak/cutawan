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
      const { original, ...rest } = seg
      return { ...rest, text: original.text, words: original.words }
    })
  }
}

/**
 * Put translated text into the segments that need it, keeping what Whisper
 * heard so "original" can bring it back. Segments without an entry are
 * already in the target language and stay as they are.
 */
export function applyTranslations(transcript: Transcript, translations: Map<number, string>, language: CaptionLanguage): Transcript {
  return {
    ...transcript,
    language: language === 'uk' ? 'uk' : transcript.language,
    captionLanguage: language,
    segments: transcript.segments.map((seg): TranscriptSegment => {
      const text = translations.get(seg.id)?.trim()
      if (!text || text === seg.text.trim()) return seg
      const original = seg.original ?? { text: seg.text, words: seg.words }
      return { ...seg, text, words: distributeWords(text, seg.start, seg.end), original }
    })
  }
}
