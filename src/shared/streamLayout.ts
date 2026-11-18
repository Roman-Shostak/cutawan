import type { Clip, StreamTemplate, VideoInfo } from './types'
import { streamComposition, streamGameSubtitleTop } from './composition'
import { automaticLayoutShots } from './contentType'

/**
 * Put a clip on the creator's stream template. The layout spans the whole
 * source, so trimming the clip anywhere keeps it, and the clip is marked as
 * analysed so no face tracking or AI layout review replaces it.
 */
export function applyStreamTemplate(clip: Clip, template: StreamTemplate, video: Pick<VideoInfo, 'width' | 'height' | 'durationSec'>): Clip {
  const composition = streamComposition(template, video)
  const end = Math.max(video.durationSec, clip.edit.end, clip.suggestedEnd)
  if (!composition) return clip
  return {
    ...clip,
    focusTrack: null,
    reframeStatus: 'done',
    reframeAnalysis: { start: 0, end, version: 2 },
    contentType: 'screencast',
    visualLayout: {
      start: 0,
      end,
      preserveContext: true,
      allowZoom: false,
      reason: 'Шаблон «Мій стрім».',
      kind: 'screen',
      revision: (clip.visualLayout?.revision ?? 0) + 1,
      shots: [{ start: 0, end, mode: 'fit', composition }]
    },
    edit: {
      ...clip.edit,
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'auto',
      autoZoom: false,
      layoutChosen: true,
      compositionPreference: 'auto'
    }
  }
}

/** The stream template a clip currently uses, if it is on one. */
export function clipStreamTemplate(clip: Pick<Clip, 'edit' | 'visualLayout'>): StreamTemplate | undefined {
  return clip.visualLayout?.shots?.find((shot) => shot.composition?.preset === 'stream')?.composition?.stream
}

/** Top edge of the game-dialogue subtitles for this clip (share of frame height), when its layout decides it. */
export function clipGameSubtitleTop(clip: Pick<Clip, 'edit' | 'visualLayout'>): number | undefined {
  for (const shot of automaticLayoutShots(clip)) {
    const top = streamGameSubtitleTop(shot.composition)
    if (top !== undefined) return top
  }
  return undefined
}
