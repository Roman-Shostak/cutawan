import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFamily } from '../src/main/fonts'
import { CAPTION_STYLES } from '@shared/captionStyles'

const fontsDir = join(__dirname, '..', 'resources', 'fonts')

describe('parseFontFamily', () => {
  it('reads the family name from bundled TTFs', () => {
    expect(parseFontFamily(readFileSync(join(fontsDir, 'Anton-Regular.ttf')))).toBe('Anton')
    // Poppins-Bold's typographic family (nameID 16) is "Poppins", not "Poppins Bold".
    expect(parseFontFamily(readFileSync(join(fontsDir, 'Poppins-Bold.ttf')))).toBe('Poppins')
    expect(parseFontFamily(readFileSync(join(fontsDir, 'Oswald-Bold.ttf')))).toBe('Oswald')
    expect(parseFontFamily(readFileSync(join(fontsDir, 'Montserrat-Bold.ttf')))).toBe('Montserrat')
    expect(parseFontFamily(readFileSync(join(fontsDir, 'Montserrat-Medium.ttf')))).toBe('Montserrat Medium')
  })

  it('rejects non-font data', () => {
    expect(parseFontFamily(Buffer.from('not a font at all'))).toBeNull()
    expect(parseFontFamily(Buffer.alloc(4))).toBeNull()
    expect(parseFontFamily(Buffer.alloc(0))).toBeNull()
  })

  it('survives a truncated font without throwing', () => {
    const full = readFileSync(join(fontsDir, 'Anton-Regular.ttf'))
    expect(() => parseFontFamily(full.subarray(0, 64))).not.toThrow()
  })
})

/** Code points covered by a font's cmap (format 4 and 12 subtables only). */
function cmapCodePoints(font: Buffer): Set<number> {
  const covered = new Set<number>()
  const numTables = font.readUInt16BE(4)
  let cmap = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (font.toString('latin1', rec, rec + 4) === 'cmap') cmap = font.readUInt32BE(rec + 8)
  }
  if (cmap < 0) return covered
  const subtables = font.readUInt16BE(cmap + 2)
  for (let i = 0; i < subtables; i++) {
    const offset = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4)
    const format = font.readUInt16BE(offset)
    if (format === 4) {
      const segX2 = font.readUInt16BE(offset + 6)
      const ends = offset + 14
      const starts = ends + segX2 + 2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = font.readUInt16BE(ends + s * 2)
        const start = font.readUInt16BE(starts + s * 2)
        if (start === 0xffff) continue
        for (let c = start; c <= end; c++) covered.add(c)
      }
    } else if (format === 12) {
      const groups = font.readUInt32BE(offset + 12)
      for (let g = 0; g < groups; g++) {
        const start = font.readUInt32BE(offset + 16 + g * 12)
        const end = font.readUInt32BE(offset + 20 + g * 12)
        for (let c = start; c <= end && c - start < 0x10000; c++) covered.add(c)
      }
    }
  }
  return covered
}

describe('bundled caption fonts', () => {
  const bundled = new Map<string, Buffer>()
  for (const file of readdirSync(fontsDir).filter((f) => /\.(ttf|otf)$/i.test(f))) {
    const data = readFileSync(join(fontsDir, file))
    const family = parseFontFamily(data)
    if (family) bundled.set(family, data)
  }

  it('ship a file for every caption style font', () => {
    for (const style of CAPTION_STYLES) expect(bundled.has(style.fontFamily), style.fontFamily).toBe(true)
  })

  it('cover the Ukrainian alphabet in every caption style font', () => {
    // Without these glyphs libass falls back to a wider system face and the
    // captions overflow the frame they were laid out for.
    const ukrainian = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюяʼ’'
    for (const family of new Set(CAPTION_STYLES.map((style) => style.fontFamily))) {
      const covered = cmapCodePoints(bundled.get(family)!)
      const missing = [...ukrainian].filter((ch) => !covered.has(ch.codePointAt(0)!))
      expect(missing, family).toEqual([])
    }
  })
})
