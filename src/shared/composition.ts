import type { Composition, ContentRegion, StreamGameZoom, StreamTemplate } from './types'
import { contentRegionPixels } from './contentRegion'

export function validRectangle(r: ContentRegion | undefined): r is ContentRegion {
  return Boolean(r && [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.x >= 0 && r.y >= 0 && r.width >= .02 && r.height >= .02 &&
    r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001)
}

function intersection(a: ContentRegion, b: ContentRegion): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}

export function validComposition(c: Composition | undefined): c is Composition {
  if (c?.version === 1 && c.preset === 'speakers') return validSpeakerComposition(c)
  if (c?.version === 1 && c.preset === 'stream') return validStreamComposition(c)
  if (!c || c.version !== 1 || !['content-first', 'stacked', 'content-only'].includes(c.preset) ||
    !Array.isArray(c.layers) || c.layers.length < 1 || c.layers.length > 2 ||
    !Number.isFinite(c.captionY) || c.captionY < .78 || c.captionY > .86) return false
  const roles = new Set<string>()
  for (const layer of c.layers) {
    if (!layer || !['content', 'presenter'].includes(layer.role) || roles.has(layer.role) ||
      !validRectangle(layer.source) || !validRectangle(layer.target) ||
      layer.target.y + layer.target.height > c.captionY - .07) return false
    roles.add(layer.role)
  }
  return roles.has('content') && (c.layers.length === 1 || intersection(c.layers[0].target, c.layers[1].target) < .000001)
}

/** Two stacked speaker panels, captions on the seam between them. */
const SPEAKER_PANELS: ContentRegion[] = [{ x: 0, y: 0, width: 1, height: .5 }, { x: 0, y: .5, width: 1, height: .5 }]
export const SPEAKER_CAPTION_Y = .5

function validSpeakerComposition(c: Composition): boolean {
  return Array.isArray(c.layers) && c.layers.length === 2 && Number.isFinite(c.captionY) &&
    c.captionY >= .4 && c.captionY <= .6 &&
    c.layers.every(l => l?.role === 'speaker' && validRectangle(l.source) && validRectangle(l.target)) &&
    intersection(c.layers[0].target, c.layers[1].target) < .000001
}

/**
 * Stack two people from the same shot: `top` and `bottom` are source
 * rectangles already shaped like a half-height 9:16 panel, so each fills its
 * panel exactly.
 */
export function speakerComposition(top: ContentRegion, bottom: ContentRegion): Composition | undefined {
  if (!validRectangle(top) || !validRectangle(bottom)) return undefined
  return { version: 1, preset: 'speakers', captionY: SPEAKER_CAPTION_Y,
    layers: [{ role: 'speaker', source: top, target: SPEAKER_PANELS[0] }, { role: 'speaker', source: bottom, target: SPEAKER_PANELS[1] }] }
}

/** Whether a composition separates screen content from a presenter inset. */
export function isPresenterComposition(c: Composition | undefined): boolean {
  return Boolean(c && c.preset !== 'speakers')
}

/** The source rectangles are independent of the source webcam's corner. */
export function presenterComposition(
  content: ContentRegion, presenter: ContentRegion,
  preset: Composition['preset'] = 'content-first'
): Composition | undefined {
  if (!validRectangle(content) || !validRectangle(presenter) ||
    intersection(content, presenter) > presenter.width * presenter.height * .15) return undefined
  const layers: Composition['layers'] = [{ role: 'content', source: content,
    target: preset === 'content-only' ? { x: .04, y: .08, width: .92, height: .66 } :
      { x: .04, y: .29, width: .92, height: .46 } }]
  if (preset !== 'content-only') layers.push({ role: 'presenter', source: presenter,
    target: preset === 'stacked' ? { x: .12, y: .03, width: .76, height: .23 } :
      { x: .64, y: .03, width: .30, height: .23 } })
  return { version: 1, preset, layers, captionY: .83 }
}

/** Return the actual fitted rectangles, not an approximate CSS contain calculation. */
export function compositionPixels(c: Composition, source: { width: number; height: number }, width: number, height: number):
  Array<{ source: ContentRegion; target: ContentRegion }> {
  if (!validComposition(c) || Math.min(source.width, source.height, width, height) < 2) return []
  return c.layers.map(layer => {
    const crop = contentRegionPixels(layer.source, source.width, source.height)
    const panel = contentRegionPixels(layer.target, width, height)
    // Stream panels are cut to their panel's shape already; even-pixel
    // rounding must not leave a hairline of black, so they fill it exactly.
    if (c.preset === 'stream') return { source: crop, target: panel }
    const scale = Math.min(panel.width / crop.width, panel.height / crop.height)
    const w = Math.max(2, Math.floor(crop.width * scale / 2) * 2)
    const h = Math.max(2, Math.floor(crop.height * scale / 2) * 2)
    return { source: crop, target: { x: panel.x + Math.floor((panel.width - w) / 4) * 2,
      y: panel.y + Math.floor((panel.height - h) / 4) * 2, width: w, height: h } }
  })
}

/** Keep small insets from becoming soft close-ups and require a useful content gain. */
export function usefulComposition(c: Composition, source: { width: number; height: number }): boolean {
  return compositionIssue(c, source) === undefined
}

/** Actionable proposal feedback; keep the acceptance threshold unchanged. */
export function compositionIssue(c: Composition, source: { width: number; height: number }): string | undefined {
  const pixels = compositionPixels(c, source, 1080, 1920)
  const baseline = Math.min(1080 / source.width, 1920 / source.height)
  if (!pixels.length) return 'Invalid or overlapping destination panels.'
  for (const [i, p] of pixels.entries()) {
    if (c.layers[i].role === 'content') {
      if (p.target.width / p.source.width < baseline * 1.2) {
        return 'Content bounds are too broad to enlarge meaningfully. Remove empty margins and unrelated page chrome; retain the relevant text, chart and labels.'
      }
    } else if (Math.min(p.source.width, p.source.height) < 80 || p.target.width / p.source.width > 3) {
      return 'Presenter bounds are too small for a clear inset. Locate the entire webcam panel, not a tight face crop.'
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Stream template: webcam panel on top, game below (9:16 only).

/** Output frame shape the stream template is laid out for. */
const STREAM_FRAME = { width: 1080, height: 1920 }
/** The webcam never takes more than this share of the frame height. */
export const STREAM_WEBCAM_MAX_HEIGHT = .36
/** Room left under a shorter game panel for the creator's captions. */
const STREAM_CAPTION_ROOM = .2
/** Share of the game width the "wide" option keeps. */
const STREAM_WIDE_SHARE = .75

const GAME_ZOOMS: StreamGameZoom[] = ['fill', 'wide', 'full']

export const DEFAULT_STREAM_TEMPLATE: StreamTemplate = { webcam: null, gameZoom: 'fill', gameFocusX: .5 }

/** A stored or IPC-supplied template with every field checked; null when unusable. */
export function normalizeStreamTemplate(raw: unknown): StreamTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<StreamTemplate>
  const webcam = validRectangle(t.webcam ?? undefined) ? { x: t.webcam!.x, y: t.webcam!.y, width: t.webcam!.width, height: t.webcam!.height } : null
  const gameZoom = GAME_ZOOMS.includes(t.gameZoom as StreamGameZoom) ? t.gameZoom as StreamGameZoom : webcam ? 'fill' : 'wide'
  const focus = Number(t.gameFocusX)
  return { webcam, gameZoom, gameFocusX: Number.isFinite(focus) ? Math.min(1, Math.max(0, focus)) : .5 }
}

function validStreamComposition(c: Composition): boolean {
  if (!Array.isArray(c.layers) || c.layers.length < 1 || c.layers.length > 2 ||
    !Number.isFinite(c.captionY) || c.captionY < .5 || c.captionY > .9) return false
  const roles = new Set<string>()
  for (const layer of c.layers) {
    if (!layer || !['content', 'presenter'].includes(layer.role) || roles.has(layer.role) ||
      !validRectangle(layer.source) || !validRectangle(layer.target)) return false
    roles.add(layer.role)
  }
  return roles.has('content') && (c.layers.length === 1 || intersection(c.layers[0].target, c.layers[1].target) < .000001)
}

/**
 * Crop `region` (source fractions) to a pixel aspect ratio, keeping its centre
 * (or `focusX` across the full width when the region is the whole frame).
 */
function cropToAspect(region: ContentRegion, aspect: number, source: { width: number; height: number }, focusX = .5): ContentRegion {
  const w = region.width * source.width, h = region.height * source.height
  if (w / h > aspect) {
    const width = (h * aspect) / source.width
    const centre = region.x + region.width * focusX
    const x = Math.min(region.x + region.width - width, Math.max(region.x, centre - width / 2))
    return { x, y: region.y, width, height: region.height }
  }
  const height = (w / aspect) / source.height
  return { x: region.x, y: region.y + (region.height - height) / 2, width: region.width, height }
}

/**
 * Lay the creator's stream out for a vertical frame. With a webcam: the
 * webcam spans the top (at most 36% of the height) and the game the rest —
 * filled edge to edge ("fill", a centre crop of the game), three quarters of
 * its width ("wide") or the whole picture ("full"); the shorter options leave
 * a strip under the game for captions. Without a webcam the game sits in the
 * middle. Source rectangles are cut to their panel's shape, so nothing is
 * letterboxed inside a panel.
 */
export function streamComposition(template: StreamTemplate, source: { width: number; height: number }): Composition | undefined {
  const t = normalizeStreamTemplate(template)
  if (!t || source.width < 2 || source.height < 2) return undefined
  const frameAspect = STREAM_FRAME.width / STREAM_FRAME.height
  let camHeight = 0
  let camSource: ContentRegion | undefined
  if (t.webcam) {
    const camAspect = (t.webcam.width * source.width) / (t.webcam.height * source.height)
    camHeight = Math.min(STREAM_WEBCAM_MAX_HEIGHT, frameAspect / camAspect)
    camSource = cropToAspect(t.webcam, frameAspect / camHeight, source)
  }
  const whole: ContentRegion = { x: 0, y: 0, width: 1, height: 1 }
  const sourceAspect = source.width / source.height
  let gameSource: ContentRegion
  let gameHeight: number
  if (t.gameZoom === 'fill') {
    gameHeight = 1 - camHeight
    gameSource = cropToAspect(whole, frameAspect / gameHeight, source, t.gameFocusX)
  } else {
    const share = t.gameZoom === 'wide' ? Math.min(1, STREAM_WIDE_SHARE * Math.max(1, sourceAspect / (16 / 9))) : 1
    gameSource = cropToAspect(whole, sourceAspect * share, source, t.gameFocusX)
    gameHeight = Math.min(1 - camHeight, frameAspect / (sourceAspect * share))
  }
  // Shorter stacks sit a little lower than the top edge, leaving the strip
  // under the game for captions.
  const stack = camHeight + gameHeight
  // Without a webcam the game sits a little above the middle instead, with
  // the captions under it.
  const top = stack >= .999 ? 0 : camSource
    ? Math.max(0, Math.min(.12, (1 - stack - STREAM_CAPTION_ROOM) / 2))
    : Math.max(.12, (1 - stack) / 2 - .05)
  const layers: Composition['layers'] = []
  if (camSource) layers.push({ role: 'presenter', source: camSource, target: { x: 0, y: top, width: 1, height: camHeight } })
  layers.push({ role: 'content', source: gameSource, target: { x: 0, y: top + camHeight, width: 1, height: Math.min(gameHeight, 1 - top - camHeight) } })
  const gameBottom = top + stack
  // Over a full-height game the captions sit in its lower third, clear of the
  // app's own buttons; otherwise in the middle of the strip under the game.
  const captionY = gameBottom >= .97 ? .72 : Math.min(.84, Math.max(.6, (gameBottom + 1) / 2))
  const composition: Composition = { version: 1, preset: 'stream', layers, captionY, stream: t }
  return validComposition(composition) ? composition : undefined
}

/**
 * Where game-dialogue subtitles start (top edge, share of the frame height)
 * under a stream composition: just below the webcam so they never cover the
 * creator's face, or near the top of the game without a webcam.
 */
export function streamGameSubtitleTop(c: Composition | undefined): number | undefined {
  if (!c || c.preset !== 'stream') return undefined
  const presenter = c.layers.find((l) => l.role === 'presenter')
  const content = c.layers.find((l) => l.role === 'content')
  if (presenter) return presenter.target.y + presenter.target.height + .012
  // Clear of the app's own tabs at the very top of the screen.
  return content ? Math.max(.08, content.target.y + .015) : undefined
}
