import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Transcript } from '@shared/types'
import { applyTranslations, distributeWords, restoreOriginal } from '@shared/captionLanguage'

const calls = vi.hoisted(() => ({ chat: [] as string[], saved: 0, fail: false }))
vi.mock('../src/main/pipeline/openai', () => ({
  chatJSON: vi.fn(async (_k: string, _m: string, messages: Array<{ content: string }>) => {
    calls.chat.push(messages[1].content)
    if (calls.fail) throw new Error('down')
    const lines = JSON.parse(messages[1].content) as Array<{ id: number; text: string }>
    return { lines: lines.filter((l) => /[ыэъё]/i.test(l.text)).map((l) => ({ id: l.id, uk: 'а що це взагалі таке' })) }
  })
}))
vi.mock('../src/main/projects', () => ({ updateProject: vi.fn(async (_id: string, fn: (p: unknown) => void) => { calls.saved++; fn({ video: { path: '/v' } }) }) }))
const { ensureCaptionLanguage } = await import('../src/main/pipeline/captionLanguage')

function transcript(): Transcript {
  return {
    language: 'uk', durationSec: 10, whisperLanguage: 'auto',
    segments: [
      { id: 0, text: 'привіт друзі', start: 0, end: 1, words: [{ text: 'привіт', start: 0, end: 0.4 }, { text: 'друзі', start: 0.5, end: 1 }] },
      { id: 1, text: 'а что это вообще такое', start: 2, end: 4, words: [{ text: 'а', start: 2, end: 2.1 }] }
    ]
  }
}
const project = (): Project => ({ id: 'p', video: { path: '/v' }, transcript: transcript() }) as unknown as Project

describe('caption language helpers', () => {
  it('spread translated words over the line in order', () => {
    const words = distributeWords('а що це взагалі таке', 2, 4)
    expect(words.map((w) => w.text)).toEqual(['а', 'що', 'це', 'взагалі', 'таке'])
    expect(words[0].start).toBe(2)
    expect(words.at(-1)!.end).toBeLessThanOrEqual(4)
  })

  it('translate only the lines given and restore them exactly', () => {
    const t = transcript()
    const uk = applyTranslations(t, new Map([[1, 'а що це взагалі таке']]), 'uk')
    expect(uk.captionLanguage).toBe('uk')
    expect(uk.segments[0]).toBe(t.segments[0])
    expect(uk.segments[1].text).toBe('а що це взагалі таке')
    expect(uk.segments[1].original?.text).toBe('а что это вообще такое')
    const back = restoreOriginal(uk)
    expect(back.segments[1].text).toBe('а что это вообще такое')
    expect(back.segments[1].words).toEqual(t.segments[1].words)
    expect(back.segments[1].original).toBeUndefined()
  })
})

describe('ensureCaptionLanguage', () => {
  beforeEach(() => { calls.chat.length = 0; calls.saved = 0; calls.fail = false })

  it('translates the non-Ukrainian lines once and saves', async () => {
    const p = project()
    const out = await ensureCaptionLanguage(p, 'uk', { apiKey: 'k', model: 'm' }, () => {}, 0.5)
    expect(out?.segments[1].text).toBe('а що це взагалі таке')
    expect(out?.segments[0].text).toBe('привіт друзі')
    expect(calls.saved).toBe(1)
    await ensureCaptionLanguage(p, 'uk', { apiKey: 'k', model: 'm' }, () => {}, 0.5)
    expect(calls.chat).toHaveLength(1)
  })

  it('switches back to the original without any request', async () => {
    const p = project()
    await ensureCaptionLanguage(p, 'uk', { apiKey: 'k', model: 'm' }, () => {}, 0.5)
    const out = await ensureCaptionLanguage(p, 'original', { apiKey: 'k', model: 'm' }, () => {}, 0.5)
    expect(out?.segments[1].text).toBe('а что это вообще такое')
    expect(calls.chat).toHaveLength(1)
  })

  it('leaves captions as recognised without a key, and retries a failed run next time', async () => {
    const p = project()
    expect(await ensureCaptionLanguage(p, 'uk', { apiKey: null, model: 'm' }, () => {}, 0.5)).toBe(p.transcript)
    calls.fail = true
    const out = await ensureCaptionLanguage(p, 'uk', { apiKey: 'k', model: 'm' }, () => {}, 0.5)
    expect(out?.captionLanguage).toBeUndefined()
    calls.fail = false
    const again = await ensureCaptionLanguage(p, 'uk', { apiKey: 'k', model: 'm' }, () => {}, 0.5)
    expect(again?.captionLanguage).toBe('uk')
  })
})
