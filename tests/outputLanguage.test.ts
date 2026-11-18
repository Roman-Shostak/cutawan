import { describe, expect, it } from 'vitest'
import { languageName, outputLanguageInstruction } from '@shared/outputLanguage'

describe('outputLanguageInstruction', () => {
  it('names Ukrainian for a Ukrainian transcript, by code or full name', () => {
    expect(languageName('uk')).toBe('Ukrainian')
    expect(languageName('Ukrainian')).toBe('Ukrainian')
    expect(outputLanguageInstruction('uk', 'the caption')).toContain('the caption in Ukrainian')
  })

  it('falls back to the speaker language when the code is unknown or auto', () => {
    for (const code of ['', 'auto', null, undefined, 'xx']) {
      expect(outputLanguageInstruction(code, 'the caption')).toContain('the same language the speaker uses')
    }
  })

  it('asks for hashtags in that language too', () => {
    expect(outputLanguageInstruction('uk', 'titles')).toMatch(/Hashtags too/)
  })
})
