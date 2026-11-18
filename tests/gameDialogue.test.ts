import { describe, expect, it } from 'vitest'
import type { Clip, GameDialogue } from '@shared/types'
import {
  GAME_LINE_MAX_CHARS,
  gameLinesInClip,
  gameSubtitlesEnabled,
  chatLineWords,
  isNoiseLine,
  speechCoverage,
  visibleChatLines,
  visibleGameLines,
  withChatLines,
  wordsToGameLines
} from '@shared/gameDialogue'
import { captionLayoutBudget, groupWords, wordsInRange } from '@shared/captionLayout'
import { resolveCaptionStyle } from '@shared/captionStyles'
import { buildAss } from '../src/main/pipeline/captions'
import { makeTranscript } from './helpers'

function clipWith(edit: Partial<Clip['edit']>): Clip {
  return { id: 'c1', edit: { start: 10, end: 30, captionsEnabled: true, ...edit } } as unknown as Clip
}

const dialogue: GameDialogue = {
  audioTrack: 2,
  targetLanguage: 'uk',
  context: '',
  lines: [
    { id: 'a', start: 5, end: 9, text: 'Before', translation: 'До' },
    { id: 'b', start: 8, end: 12, text: 'Get down!', translation: 'Лягай!' },
    { id: 'c', start: 15, end: 17, text: 'Where is Ellie?', translation: 'Де Еллі?' },
    { id: 'd', start: 20, end: 22, text: '...', translation: '' },
    { id: 'f', start: 24, end: 26, text: 'Брат, ти бачив?', translation: 'Брат, ти бачив?', speaker: 'chat' },
    { id: 'e', start: 29, end: 33, text: 'Run.', translation: 'Біжи.' }
  ]
}

describe('isNoiseLine', () => {
  it('drops lines without letters and the stock phrases Whisper invents over music', () => {
    expect(isNoiseLine('...')).toBe(true)
    expect(isNoiseLine('♪ ♪')).toBe(true)
    expect(isNoiseLine('Thanks for watching!')).toBe(true)
    expect(isNoiseLine('Продолжение следует...')).toBe(true)
    expect(isNoiseLine('Субтитры сделал DimaTorzok')).toBe(true)
  })

  it('keeps a short stock phrase when the voice detector heard speech', () => {
    expect(isNoiseLine('Thank you.', 0.9)).toBe(false)
    expect(isNoiseLine('Thank you.', 0.3)).toBe(true)
  })

  it('drops anything mostly outside detected speech', () => {
    expect(isNoiseLine('We have to move now', 0.1)).toBe(true)
    expect(isNoiseLine('We have to move now', 0.8)).toBe(false)
  })
})

describe('speechCoverage', () => {
  it('is the share of the line covered by voice activity', () => {
    expect(speechCoverage(0, 2, undefined)).toBe(1)
    expect(speechCoverage(0, 2, [{ start: 1, end: 5 }])).toBeCloseTo(0.5)
    expect(speechCoverage(0, 2, [])).toBe(0)
  })
})

describe('wordsToGameLines', () => {
  it('breaks on sentence ends and long pauses', () => {
    const words = [
      { text: ' Get', start: 0, end: 0.3 }, { text: ' down!', start: 0.35, end: 0.7 },
      { text: ' They', start: 0.8, end: 1 }, { text: ' are', start: 1.05, end: 1.2 },
      { text: ' here', start: 3, end: 3.3 }
    ]
    expect(wordsToGameLines(words)).toEqual([
      { start: 0, end: 0.7, text: 'Get down!' },
      { start: 0.8, end: 1.2, text: 'They are' },
      { start: 3, end: 3.3, text: 'here' }
    ])
  })

  it('keeps every line within the length budget', () => {
    const words = Array.from({ length: 60 }, (_, i) => ({ text: 'word', start: i * 0.2, end: i * 0.2 + 0.15 }))
    const lines = wordsToGameLines(words)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.text.length).toBeLessThanOrEqual(GAME_LINE_MAX_CHARS)
      expect(line.end - line.start).toBeLessThanOrEqual(6)
    }
  })
})

describe('clip game lines', () => {
  it('are on by default and can be switched off per clip', () => {
    expect(gameSubtitlesEnabled(clipWith({}), dialogue)).toBe(true)
    expect(gameSubtitlesEnabled(clipWith({ gameSubtitles: false }), dialogue)).toBe(false)
    expect(gameSubtitlesEnabled(clipWith({}), null)).toBe(false)
    expect(visibleGameLines(clipWith({ gameSubtitles: false }), dialogue)).toEqual([])
  })

  it('lists lines overlapping the trim, hidden or not', () => {
    expect(gameLinesInClip(clipWith({ hiddenGameLines: ['c'] }), dialogue).map((l) => l.id)).toEqual(['b', 'c', 'd', 'f', 'e'])
  })

  it('shows only unhidden lines with text, clamped to the trim', () => {
    expect(visibleGameLines(clipWith({ hiddenGameLines: ['c'] }), dialogue)).toEqual([
      { id: 'b', start: 10, end: 12, text: 'Лягай!' },
      { id: 'e', start: 29, end: 30, text: 'Біжи.' }
    ])
  })
})

describe('friend chat lines', () => {
  it('stay out of the game subtitles and follow the caption switch instead', () => {
    expect(visibleGameLines(clipWith({}), dialogue).map((l) => l.id)).toEqual(['b', 'c', 'e'])
    expect(visibleChatLines(clipWith({}), dialogue)).toEqual([{ id: 'f', start: 24, end: 26, text: 'Брат, ти бачив?' }])
    expect(visibleChatLines(clipWith({ gameSubtitles: false }), dialogue)).toHaveLength(1)
    expect(visibleChatLines(clipWith({ captionsEnabled: false }), dialogue)).toEqual([])
    expect(visibleChatLines(clipWith({ hiddenGameLines: ['f'] }), dialogue)).toEqual([])
  })

  it('a project with only chat has no game subtitles to switch on', () => {
    const chatOnly = { ...dialogue, lines: dialogue.lines.filter((l) => l.speaker === 'chat') }
    expect(gameSubtitlesEnabled(clipWith({}), chatOnly)).toBe(false)
  })

  it('spread the text over the line, marked as chat', () => {
    const words = chatLineWords({ start: 2, end: 4, text: 'Брат, ти бачив?' })
    expect(words.map((w) => w.text)).toEqual(['Брат,', 'ти', 'бачив?'])
    expect(words.every((w) => w.speaker === 'chat')).toBe(true)
    expect(words[0].start).toBe(2)
    expect(words[2].end).toBeLessThanOrEqual(4)
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end)
  })

  it('merge into the creator captions without touching the original transcript', () => {
    const transcript = makeTranscript(['ну ти бачив це'], { startSec: 0, wordSec: 0.4, gapSec: 0.1 })
    const merged = withChatLines(transcript, [{ start: 3, end: 4.5, text: 'Та бачив, жесть!' }])!
    expect(transcript.segments).toHaveLength(1)
    expect(merged.segments).toHaveLength(2)
    expect(merged.segments[1].id).toBe(1)
    const words = wordsInRange(merged, 0, 10)
    expect(words.map((w) => w.text)).toEqual(['ну', 'ти', 'бачив', 'це', 'Та', 'бачив,', 'жесть!'])
    expect(withChatLines(transcript, [])).toBe(transcript)
    expect(withChatLines(null, [{ start: 1, end: 2, text: 'Го!' }])?.segments).toHaveLength(1)
  })

  it('never share a caption block with the creator, even when talking over each other', () => {
    const transcript = makeTranscript(['ну ти бачив це взагалі'], { startSec: 0, wordSec: 0.3, gapSec: 0.05 })
    const merged = withChatLines(transcript, [{ start: 0.7, end: 1.2, text: 'Ага' }])!
    const budget = captionLayoutBudget(resolveCaptionStyle('beast'), 9 / 16)
    for (const group of groupWords(wordsInRange(merged, 0, 10), budget)) {
      expect(new Set(group.words.map((w) => w.speaker ?? 'creator')).size).toBe(1)
    }
  })
})

describe('buildAss game subtitles', () => {
  const transcript = makeTranscript(['hello brave new world'], { wordSec: 0.5, gapSec: 0.1 })
  const base = { styleId: 'beast', width: 1080, height: 1920, clipStart: 0, clipEnd: 10 }
  const gameLines = [
    { start: 1, end: 3, text: 'Лягай!' },
    { start: 6, end: 8, text: 'Де {Еллі}?' }
  ]

  it('adds a Game style and one event per line near the top of the frame', () => {
    const ass = buildAss(transcript, { ...base, gameLines })
    expect(ass).toMatch(/Style: Game,Montserrat Medium,/)
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue: 2,'))
    expect(events).toHaveLength(2)
    expect(events[0]).toContain('0:00:01.00,0:00:03.00,Game,,0,0,288,')
    expect(events[0]).toContain('Лягай!')
    // Override braces in the text must not reach libass as tags.
    expect(events[1]).not.toContain('{Еллі}')
  })

  it('drops below the hook title while it is on screen', () => {
    const ass = buildAss(transcript, { ...base, gameLines, title: 'Хук' })
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue: 2,'))
    expect(events[0]).toContain(',Game,,0,0,518,')
    expect(events[1]).toContain(',Game,,0,0,288,')
  })

  it('burns game lines without the spoken captions when those are off', () => {
    const ass = buildAss(transcript, { ...base, gameLines, voiceCaptions: false })
    expect(ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'))).toHaveLength(0)
    expect(ass.split('\n').filter((l) => l.startsWith('Dialogue: 2,'))).toHaveLength(2)
  })

  it('leaves the script unchanged without game lines', () => {
    const ass = buildAss(transcript, base)
    expect(ass).not.toContain('Dialogue: 2,')
  })
})
