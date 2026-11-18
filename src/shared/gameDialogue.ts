import type { Clip, GameDialogue, GameDialogueLine, SpeechRegion, Transcript, TranscriptWord } from './types'

/**
 * Game-dialogue subtitles: speech from the game's own audio track, shown as a
 * second, smaller subtitle layer translated for the creator's audience.
 *
 * Shared by the main process (building lines, burning them into exports) and
 * the renderer (preview and editor) so both place and filter them the same.
 */

/** Longest a single subtitle stays on screen before it is split, in seconds. */
export const GAME_LINE_MAX_SEC = 6
/** Longest a single subtitle may be before it is split, in characters. */
export const GAME_LINE_MAX_CHARS = 72
/** A pause this long between words always starts a new subtitle. */
const GAME_LINE_BREAK_PAUSE_SEC = 0.8

/** How the game-dialogue layer looks; preview and export both read this. */
export const GAME_SUBTITLE_STYLE = {
  fontFamily: 'Montserrat Medium',
  /** Font size as a fraction of video height. */
  fontScale: 0.027,
  /** Top edge of the subtitle block, as a fraction of video height. */
  positionY: 0.15,
  /** Where the block moves while the hook title occupies the top of the frame. */
  belowTitleY: 0.27,
  /** Share of the frame width the text may span before wrapping. */
  maxWidth: 0.86,
  textColor: '#FFFFFF',
  /** Box behind the text, as #RRGGBB plus opacity 0..1. */
  boxColor: '#000000',
  boxOpacity: 0.62
} as const

/** How long the hook title stays on screen (mirrors the ASS title event). */
export const HOOK_TITLE_SEC = 4

/**
 * Phrases Whisper invents over music, silence or effects. A game track is
 * full of those, so a line that is only one of these is noise, not dialogue.
 */
const HALLUCINATIONS = [
  'thank you for watching', 'thanks for watching', 'thank you', 'thanks', 'please subscribe',
  'like and subscribe', 'subscribe to my channel', 'subtitles by', 'transcription by', 'amara.org',
  'you', 'bye', 'music', 'applause', 'silence',
  'продолжение следует', 'спасибо за просмотр', 'спасибо', 'субтитры сделал', 'субтитры создавал',
  'редактор субтитров', 'корректор', 'подписывайтесь на канал', 'dimatorzok',
  'дякую за перегляд', 'дякую', 'підписуйтесь на канал', 'субтитри зроблено'
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when a transcribed line is noise rather than dialogue: no words at all,
 * a long stock phrase Whisper invents over music ("thanks for watching",
 * "субтитры сделал…"), a short one ("thank you") over audio the voice
 * detector did not hear as speech, or anything mostly outside detected speech.
 * `speechShare` is the share of the line covered by voice activity (1 if unknown).
 */
export function isNoiseLine(text: string, speechShare = 1): boolean {
  const clean = normalize(text)
  if (!/\p{L}/u.test(clean)) return true
  if (speechShare < 0.25) return true
  return HALLUCINATIONS.some((phrase) =>
    phrase.length > 12 ? clean.includes(phrase) : clean === phrase && speechShare < 0.6)
}

/** Share of [start, end] covered by detected speech (1 when no VAD data). */
export function speechCoverage(start: number, end: number, speech: SpeechRegion[] | undefined): number {
  if (!speech) return 1
  const span = Math.max(0.001, end - start)
  let covered = 0
  for (const r of speech) {
    const overlap = Math.min(end, r.end) - Math.max(start, r.start)
    if (overlap > 0) covered += overlap
  }
  return Math.min(1, covered / span)
}

/**
 * Split transcribed words into subtitle-sized lines: break on sentence ends,
 * long pauses, and before a line outgrows GAME_LINE_MAX_SEC or
 * GAME_LINE_MAX_CHARS.
 */
export function wordsToGameLines(words: TranscriptWord[]): Array<{ start: number; end: number; text: string }> {
  const lines: Array<{ start: number; end: number; text: string }> = []
  let current: TranscriptWord[] = []
  const flush = (): void => {
    if (!current.length) return
    const text = current.map((w) => w.text.trim()).join(' ').replace(/\s+([,.!?…:;])/g, '$1').trim()
    lines.push({ start: current[0].start, end: current[current.length - 1].end, text })
    current = []
  }
  for (const word of words.filter((w) => w.text.trim().length > 0)) {
    const prev = current[current.length - 1]
    if (prev) {
      const pause = word.start - prev.end
      const length = current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length
      const duration = word.end - current[0].start
      if (pause >= GAME_LINE_BREAK_PAUSE_SEC || length > GAME_LINE_MAX_CHARS || duration > GAME_LINE_MAX_SEC) flush()
    }
    current.push(word)
    if (/[.!?…]["»”']?$/.test(word.text.trim())) flush()
  }
  flush()
  return lines
}

/** True when a line is players talking (party chat), not the game. */
export function isChatLine(line: Pick<GameDialogueLine, 'speaker'>): boolean {
  return line.speaker === 'chat'
}

/** True when the clip burns game subtitles (on by default once the project has game lines). */
export function gameSubtitlesEnabled(clip: Clip, dialogue: GameDialogue | null | undefined): boolean {
  return !!dialogue?.lines.some((line) => !isChatLine(line)) && clip.edit.gameSubtitles !== false
}

/** Game lines that overlap the clip's trim, whether hidden or not, in source order. */
export function gameLinesInClip(clip: Clip, dialogue: GameDialogue | null | undefined): GameDialogueLine[] {
  if (!dialogue) return []
  const { start, end } = clip.edit
  return dialogue.lines.filter((line) => line.end > start && line.start < end)
}

/**
 * Lines to actually show for a clip: inside its trim, not hidden by the
 * creator, with text to show, clamped to the trim. Source seconds.
 */
export function visibleGameLines(clip: Clip, dialogue: GameDialogue | null | undefined): Array<{ id: string; start: number; end: number; text: string }> {
  if (!gameSubtitlesEnabled(clip, dialogue)) return []
  return shownLines(clip, dialogue, false)
}

/**
 * The friend's party-chat lines to caption with the creator's own words:
 * same rules as game lines (trim, hidden, text), but governed by the clip's
 * caption switch rather than the game-subtitle one.
 */
export function visibleChatLines(clip: Clip, dialogue: GameDialogue | null | undefined): Array<{ id: string; start: number; end: number; text: string }> {
  if (!clip.edit.captionsEnabled) return []
  return shownLines(clip, dialogue, true)
}

function shownLines(clip: Clip, dialogue: GameDialogue | null | undefined, chat: boolean): Array<{ id: string; start: number; end: number; text: string }> {
  const hidden = new Set(clip.edit.hiddenGameLines ?? [])
  return gameLinesInClip(clip, dialogue)
    .filter((line) => isChatLine(line) === chat && !hidden.has(line.id) && line.translation.trim().length > 0)
    .map((line) => ({
      id: line.id,
      start: Math.max(line.start, clip.edit.start),
      end: Math.min(line.end, clip.edit.end),
      text: line.translation.trim()
    }))
    .filter((line) => line.end - line.start > 0.05)
}

/**
 * Spread a chat line's text over its span as caption words, weighted by
 * length so long words stay up longer. The text may be a translation, so
 * the original word timings cannot be reused.
 */
export function chatLineWords(line: { start: number; end: number; text: string }): TranscriptWord[] {
  const texts = line.text.split(/\s+/).filter(Boolean)
  if (!texts.length) return []
  const weights = texts.map((t) => t.length + 2)
  const total = weights.reduce((a, b) => a + b, 0)
  const span = Math.max(0.1, line.end - line.start)
  let t = line.start
  return texts.map((text, i) => {
    const length = (span * weights[i]) / total
    const word: TranscriptWord = { text, start: t, end: t + length * 0.92, speaker: 'chat' }
    t += length
    return word
  })
}

/**
 * The creator's transcript with the friend's chat lines merged in as extra
 * words, so they caption in the same style and place. The original is not
 * changed; cuts and analysis keep using the creator's words only.
 */
export function withChatLines(transcript: Transcript | null, lines: Array<{ start: number; end: number; text: string }>): Transcript | null {
  if (!lines.length) return transcript
  const base: Transcript = transcript ?? { language: '', durationSec: 0, segments: [] }
  const nextId = base.segments.reduce((max, seg) => Math.max(max, seg.id), -1) + 1
  const extra = lines
    .map((line) => ({ line, words: chatLineWords(line) }))
    .filter(({ words }) => words.length > 0)
    .map(({ line, words }, i) => ({ id: nextId + i, text: line.text, start: line.start, end: line.end, words }))
  return { ...base, segments: [...base.segments, ...extra].sort((a, b) => a.start - b.start) }
}
