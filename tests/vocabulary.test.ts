import { describe, expect, it } from 'vitest'
import { vocabularyPrompt } from '../src/main/pipeline/transcribe'

describe('vocabularyPrompt', () => {
  it('turns a free-form list into a short Whisper prompt', () => {
    expect(vocabularyPrompt('sh0stack, The Last of Us\nЕллі;  Джоел ')).toBe('sh0stack, The Last of Us, Еллі, Джоел.')
    expect(vocabularyPrompt('  ')).toBe('')
  })

  it('stays within the prompt budget', () => {
    const prompt = vocabularyPrompt(Array.from({ length: 200 }, (_, i) => `слово${i}`).join(','))
    expect(prompt.length).toBeLessThanOrEqual(301)
  })
})
