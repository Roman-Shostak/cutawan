import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/types'

const calls = vi.hoisted(() => ({
  extract: [] as unknown[][],
  transcribe: [] as unknown[][],
  chat: [] as Array<{ system: string; user: string }>,
  saved: [] as unknown[]
}))

vi.mock('../src/main/pipeline/ffmpeg', () => ({
  AUDIO_CHUNK_SEC: 600,
  extractAudioChunks: vi.fn(async (...args: unknown[]) => {
    calls.extract.push(args)
    return [{ path: '/tmp/a.mp3', offset: 0 }]
  })
}))
vi.mock('../src/main/pipeline/openai', () => ({
  transcriptionChunkSec: (sec: number) => sec,
  chatJSON: vi.fn(async (_key: string, _model: string, messages: Array<{ content: string }>) => {
    calls.chat.push({ system: messages[0].content, user: messages[1].content })
    const batch = JSON.parse(messages[1].content.split('(JSON):\n')[1]) as Array<{ id: string; text: string }>
    return { lines: batch.map((l) => ({
      id: l.id,
      speaker: l.text.startsWith('Брат') ? 'chat' : 'game',
      translation: l.text.startsWith('Ugh') ? '' : l.text.startsWith('Брат') ? l.text : `UK:${l.text}`
    })) }
  })
}))
vi.mock('../src/main/pipeline/transcribe', () => ({
  transcribeChunks: vi.fn(async (...args: unknown[]) => {
    calls.transcribe.push(args)
    const words = [
      { text: 'Joel,', start: 1, end: 1.3 }, { text: 'get', start: 1.35, end: 1.5 }, { text: 'down!', start: 1.55, end: 1.9 },
      { text: 'Thanks', start: 10, end: 10.3 }, { text: 'for', start: 10.35, end: 10.5 }, { text: 'watching!', start: 10.55, end: 11 },
      { text: 'Ugh.', start: 14, end: 14.4 },
      { text: 'Брат,', start: 16, end: 16.3 }, { text: 'ти', start: 16.35, end: 16.5 }, { text: 'бачив?', start: 16.55, end: 17 }
    ]
    return { language: 'english', durationSec: 20, segments: [{ id: 0, text: '', start: 1, end: 14.4, words }] }
  })
}))
vi.mock('../src/main/pipeline/projectTranscript', () => ({
  speechFor: vi.fn(async () => [{ start: 0.9, end: 2 }, { start: 13.9, end: 14.5 }, { start: 15.9, end: 17.1 }])
}))
vi.mock('../src/main/projects', () => ({
  updateProject: vi.fn(async (_id: string, fn: (p: unknown) => void) => {
    const p = { video: { path: '/v.mkv' }, sourceRevision: 0, gameDialogue: null }
    fn(p)
    calls.saved.push(p.gameDialogue)
    return p
  })
}))
vi.mock('../src/main/settings', () => ({ getAnalysisCredential: () => 'k', getModelPreferences: () => ({}), getTranscriptionVocabulary: () => '' }))

const { ensureGameDialogue } = await import('../src/main/pipeline/gameDialogue')

function project(): Project {
  return { id: 'p', video: { path: '/v.mkv', durationSec: 20 }, sourceRevision: 0, gameDialogue: null } as unknown as Project
}
const options = {
  apiKey: 'k', transcriptionModel: 'whisper', analysisModel: 'claude', audioTrack: 2,
  context: 'The Last of Us', targetLanguage: 'uk', span: { from: 0, to: 1 }
}

describe('ensureGameDialogue', () => {
  beforeEach(() => {
    calls.extract.length = 0; calls.transcribe.length = 0; calls.chat.length = 0; calls.saved.length = 0
  })

  it('transcribes the game track in auto language, drops noise and translates with the game context', async () => {
    const p = project()
    const dialogue = await ensureGameDialogue(p, '/tmp', options, () => {})
    expect(calls.extract[0][6]).toBe(2)
    expect(calls.transcribe[0][3]).toBe('auto')
    expect(calls.chat[0].system).toContain('Ukrainian')
    expect(calls.chat[0].system).toContain('The Last of Us')
    // "Thanks for watching!" is a Whisper hallucination; "Ugh." came back empty from the translator.
    expect(dialogue?.lines.map((l) => [l.text, l.translation, l.speaker])).toEqual([
      ['Joel, get down!', 'UK:Joel, get down!', 'game'],
      ['Брат, ти бачив?', 'Брат, ти бачив?', 'chat']
    ])
    expect(calls.chat[0].system).toContain('party chat')
    expect(dialogue?.lines[0].language).toBe('english')
    expect(p.gameDialogue).toBe(dialogue)
    expect(calls.saved[0]).toEqual(dialogue)
  })

  it('reuses saved dialogue and only re-translates when the context changes', async () => {
    const p = project()
    await ensureGameDialogue(p, '/tmp', options, () => {})
    await ensureGameDialogue(p, '/tmp', options, () => {})
    expect(calls.transcribe).toHaveLength(1)
    expect(calls.chat).toHaveLength(1)
    await ensureGameDialogue(p, '/tmp', { ...options, context: 'Metro Exodus' }, () => {})
    expect(calls.transcribe).toHaveLength(1)
    expect(calls.chat).toHaveLength(2)
    expect(calls.chat[1].system).toContain('Metro Exodus')
  })

  it('keeps the original text when there is no key to translate with', async () => {
    const dialogue = await ensureGameDialogue(project(), '/tmp', { ...options, translateKey: null }, () => {})
    expect(calls.chat).toHaveLength(0)
    expect(dialogue?.lines.map((l) => l.translation)).toEqual(['Joel, get down!', 'Ugh.', 'Брат, ти бачив?'])
  })

  it('keeps a speaker the creator chose by hand when re-translating', async () => {
    const p = project()
    await ensureGameDialogue(p, '/tmp', options, () => {})
    const joel = p.gameDialogue!.lines[0]
    joel.speaker = 'chat'
    joel.speakerSetByUser = true
    await ensureGameDialogue(p, '/tmp', { ...options, context: 'Інша гра' }, () => {})
    expect(p.gameDialogue!.lines[0].speaker).toBe('chat')
    expect(p.gameDialogue!.lines[1].speaker).toBe('chat')
  })
})
