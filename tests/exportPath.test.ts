import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { exportBaseName, sanitizeFileName, uniqueOutputPath } from '../src/main/exportPath'

describe('sanitizeFileName', () => {
  it('strips characters that are invalid on any OS', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeFileName('  hello   world  ')).toBe('hello world')
  })

  it('falls back to "clip" when nothing survives', () => {
    expect(sanitizeFileName('???')).toBe('clip')
  })

  it('caps length at 80 characters', () => {
    expect(sanitizeFileName('x'.repeat(200)).length).toBe(80)
  })
})

describe('uniqueOutputPath', () => {
  it('returns the plain name when free', () => {
    expect(uniqueOutputPath('/out', 'My Clip', () => false)).toBe(join('/out', 'My Clip.mp4'))
  })

  it('appends (2), (3)… until a free name is found', () => {
    const taken = new Set([join('/out', 'My Clip.mp4'), join('/out', 'My Clip (2).mp4')])
    expect(uniqueOutputPath('/out', 'My Clip', (p) => taken.has(p))).toBe(
      join('/out', 'My Clip (3).mp4')
    )
  })
})

describe('exportBaseName', () => {
  const project = {
    createdAt: Date.UTC(2026, 0, 2, 12),
    video: { fileName: '2026-11-18 20-31-05.mkv' },
    clips: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    gameDialogue: { context: 'The Last of Us: Part II' }
  } as unknown as Parameters<typeof exportBaseName>[0]

  it('names exports by recording date, game, number and title', () => {
    expect(exportBaseName(project, { id: 'c', title: 'Джоел ледь не помер?' })).toBe('2026-11-18_The Last of Us Part II_03_Джоел ледь не помер')
  })

  it('falls back to the project date and skips a missing game', () => {
    const plain = { ...project, video: { fileName: 'stream.mp4' }, gameDialogue: null } as unknown as typeof project
    expect(exportBaseName(plain, { id: 'a', title: 'Клік' })).toBe('2026-01-02_01_Клік')
  })
})
