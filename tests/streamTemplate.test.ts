import { describe, expect, it } from 'vitest'
import type { Clip } from '@shared/types'
import {
  compositionPixels,
  DEFAULT_STREAM_TEMPLATE,
  normalizeStreamTemplate,
  streamComposition,
  streamGameSubtitleTop,
  validComposition
} from '@shared/composition'
import { applyStreamTemplate, clipGameSubtitleTop, clipStreamTemplate } from '@shared/streamLayout'
import { automaticLayoutShots, compositionHidesTitle, detailCaptionRanges } from '@shared/contentType'
import { mergeClipSave, needsReframe } from '@shared/reframe'
import { initialClipEditForVideoType, shouldAnalyzeFaces } from '@shared/videoType'

const SOURCE = { width: 1920, height: 1080 }
// A 16:9 webcam in the top-right corner of a 1080p OBS scene.
const CORNER_CAM = { x: 0.75, y: 0.02, width: 0.24, height: 0.24 }

describe('normalizeStreamTemplate', () => {
  it('rejects junk and fills sensible defaults', () => {
    expect(normalizeStreamTemplate(null)).toBeNull()
    expect(normalizeStreamTemplate({ webcam: { x: 2, y: 0, width: .1, height: .1 }, gameZoom: 'huge', gameFocusX: 7 }))
      .toEqual({ webcam: null, gameZoom: 'wide', gameFocusX: 1 })
    expect(normalizeStreamTemplate({ webcam: CORNER_CAM, gameZoom: 'full' })?.gameFocusX).toBe(.5)
  })
})

describe('streamComposition', () => {
  it('puts a 16:9 webcam across the top and fills the rest with the game', () => {
    const c = streamComposition({ webcam: CORNER_CAM, gameZoom: 'fill', gameFocusX: .5 }, SOURCE)!
    expect(validComposition(c)).toBe(true)
    const cam = c.layers.find((l) => l.role === 'presenter')!
    const game = c.layers.find((l) => l.role === 'content')!
    expect(cam.target.y).toBe(0)
    expect(cam.target.height).toBeCloseTo(0.316, 2)
    expect(game.target.y + game.target.height).toBeCloseTo(1, 5)
    // Captions over the lower third of the game; game lines under the webcam.
    expect(c.captionY).toBeCloseTo(.72)
    expect(streamGameSubtitleTop(c)).toBeCloseTo(cam.target.height + .012, 5)
  })

  it('fills each panel edge to edge without letterboxing', () => {
    for (const gameZoom of ['fill', 'wide', 'full'] as const) {
      const c = streamComposition({ webcam: CORNER_CAM, gameZoom, gameFocusX: .5 }, SOURCE)!
      for (const [i, p] of compositionPixels(c, SOURCE, 1080, 1920).entries()) {
        const panelWidth = c.layers[i].target.width * 1080
        expect(Math.abs(p.target.width - panelWidth)).toBeLessThanOrEqual(4)
      }
    }
  })

  it('shows more of the game with the wider options and keeps a caption strip under it', () => {
    const fill = streamComposition({ webcam: CORNER_CAM, gameZoom: 'fill', gameFocusX: .5 }, SOURCE)!
    const wide = streamComposition({ webcam: CORNER_CAM, gameZoom: 'wide', gameFocusX: .5 }, SOURCE)!
    const full = streamComposition({ webcam: CORNER_CAM, gameZoom: 'full', gameFocusX: .5 }, SOURCE)!
    const width = (c: typeof fill): number => c.layers.find((l) => l.role === 'content')!.source.width
    expect(width(fill)).toBeLessThan(width(wide))
    expect(width(wide)).toBeLessThan(width(full))
    expect(width(full)).toBe(1)
    const bottom = (c: typeof fill): number => { const g = c.layers.find((l) => l.role === 'content')!.target; return g.y + g.height }
    expect(full.captionY).toBeGreaterThan(bottom(full))
    expect(wide.captionY).toBeGreaterThan(bottom(wide))
  })

  it('moves the game crop with the focus slider, never past the frame', () => {
    const left = streamComposition({ webcam: CORNER_CAM, gameZoom: 'fill', gameFocusX: 0 }, SOURCE)!
    const right = streamComposition({ webcam: CORNER_CAM, gameZoom: 'fill', gameFocusX: 1 }, SOURCE)!
    const gameOf = (c: typeof left) => c.layers.find((l) => l.role === 'content')!.source
    expect(gameOf(left).x).toBe(0)
    expect(gameOf(right).x + gameOf(right).width).toBeCloseTo(1, 5)
  })

  it('caps a tall webcam and crops it to its panel', () => {
    const square = { x: .7, y: .05, width: .2, height: .2 * 1920 / 1080 }
    const c = streamComposition({ webcam: square, gameZoom: 'fill', gameFocusX: .5 }, SOURCE)!
    const cam = c.layers.find((l) => l.role === 'presenter')!
    expect(cam.target.height).toBeCloseTo(.36, 5)
    expect(cam.source.height).toBeLessThan(square.height)
  })

  it('works without a webcam, keeping game lines clear of the app tabs', () => {
    const c = streamComposition(DEFAULT_STREAM_TEMPLATE, SOURCE)!
    expect(c.layers.map((l) => l.role)).toEqual(['content'])
    expect(streamGameSubtitleTop(c)).toBeGreaterThanOrEqual(.08)
  })
})

describe('applyStreamTemplate', () => {
  const clip = {
    id: 'c', suggestedStart: 100, suggestedEnd: 130, title: 't', hook: '', summary: '', viralityScore: 70,
    viralityReason: '', visualSummary: null, hashtags: [], thumbnailPath: null, focusTrack: null, broll: [],
    reframeStatus: 'pending',
    edit: { aspect: '9:16', reframeMode: 'fit-blur', framing: 'manual', tightenCuts: false, autoZoom: false, focusX: .5,
      captionsEnabled: true, captionStyleId: 'beast', showTitle: false, start: 100, end: 130 }
  } as unknown as Clip
  const video = { ...SOURCE, durationSec: 3600 }
  const template = { webcam: CORNER_CAM, gameZoom: 'fill' as const, gameFocusX: .5 }

  it('lays the clip out on the template and needs no further analysis, wherever it is trimmed', () => {
    const placed = applyStreamTemplate(clip, template, video)
    expect(needsReframe(placed)).toBe(false)
    expect(clipStreamTemplate(placed)?.webcam).toEqual(CORNER_CAM)
    const shots = automaticLayoutShots(placed)
    expect(shots).toHaveLength(1)
    expect(shots[0].composition?.preset).toBe('stream')
    const widened = { ...placed, edit: { ...placed.edit, start: 20, end: 3000 } }
    expect(needsReframe(widened)).toBe(false)
    expect(automaticLayoutShots(widened)[0].composition?.preset).toBe('stream')
    expect(detailCaptionRanges(placed)[0].positionY).toBeCloseTo(.72)
    expect(compositionHidesTitle(placed)).toBe(true)
    expect(clipGameSubtitleTop(placed)).toBeGreaterThan(.3)
  })

  it('survives saving over an older analysed copy and turns pause-cutting off', () => {
    const analysed = { ...clip, reframeStatus: 'done', reframeAnalysis: { start: 100, end: 130, version: 2 },
      edit: { ...clip.edit, tightenCuts: true },
      visualLayout: { start: 100, end: 130, preserveContext: true, allowZoom: false, reason: '', shots: [{ start: 100, end: 130, mode: 'fit' }] } } as unknown as Clip
    const placed = applyStreamTemplate(analysed, template, video)
    expect(placed.edit.tightenCuts).toBe(false)
    const saved = mergeClipSave(placed, analysed, 'auto')
    expect(clipStreamTemplate(saved)).toBeDefined()
    expect(needsReframe(saved)).toBe(false)
  })

  it('a stream composition is not converted by the presenter presets', () => {
    const placed = applyStreamTemplate(clip, template, video)
    const withPreference = { ...placed, edit: { ...placed.edit, compositionPreference: 'stacked' as const } }
    expect(automaticLayoutShots(withPreference)[0].composition?.preset).toBe('stream')
  })
})

describe('gaming-stream video type', () => {
  it('skips face tracking and keeps pauses', () => {
    expect(shouldAnalyzeFaces('gaming-stream')).toBe(false)
    expect(initialClipEditForVideoType('gaming-stream')).toMatchObject({ tightenCuts: false, autoZoom: false })
  })
})
