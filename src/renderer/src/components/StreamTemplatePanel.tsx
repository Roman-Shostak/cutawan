import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MonitorPlay } from 'lucide-react'
import type { ContentRegion, Project, StreamGameZoom, StreamTemplate } from '@shared/types'
import { compositionPixels, streamComposition, streamGameSubtitleTop } from '@shared/composition'

/**
 * "My stream" template: the creator outlines the webcam on a frame of the
 * recording once, picks how much of the game to show, and sees the vertical
 * result live. Every clip of a gaming stream is cut on this layout, and the
 * next video starts from it.
 */

const ZOOMS: Array<{ value: StreamGameZoom; label: string; hint: string }> = [
  { value: 'fill', label: 'Крупно', hint: 'Гра на всю висоту, обрізані боки' },
  { value: 'wide', label: 'Ширше', hint: '¾ ширини гри, субтитри під нею' },
  { value: 'full', label: 'Уся гра', hint: 'Увесь кадр гри, нічого не обрізано' }
]

const PREVIEW_W = 180
const PREVIEW_H = 320

export default function StreamTemplatePanel({ project, template, onChange }: {
  project: Project
  template: StreamTemplate
  onChange: (template: StreamTemplate) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<ContentRegion | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [frameTime, setFrameTime] = useState(() => Math.min(60, project.video.durationSec * 0.3))
  const source = useMemo(() => ({ width: project.video.width, height: project.video.height }), [project.video.width, project.video.height])
  const composition = useMemo(() => streamComposition(template, source), [template, source])

  const draw = useCallback((): void => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H)
    if (!composition) return
    const sourceSize = { width: video.videoWidth || source.width, height: video.videoHeight || source.height }
    for (const layer of compositionPixels(composition, sourceSize, PREVIEW_W, PREVIEW_H)) {
      ctx.drawImage(video, layer.source.x, layer.source.y, layer.source.width, layer.source.height,
        layer.target.x, layer.target.y, layer.target.width, layer.target.height)
    }
    // Where the text goes: game subtitles (grey) and the creator's captions (yellow).
    const gameTop = streamGameSubtitleTop(composition)
    if (gameTop !== undefined) {
      ctx.fillStyle = 'rgba(0,0,0,0.62)'
      ctx.fillRect(PREVIEW_W * 0.2, gameTop * PREVIEW_H, PREVIEW_W * 0.6, 9)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(PREVIEW_W * 0.24, gameTop * PREVIEW_H + 3.5, PREVIEW_W * 0.52, 2)
    }
    ctx.fillStyle = '#facc15'
    ctx.fillRect(PREVIEW_W * 0.22, composition.captionY * PREVIEW_H - 6, PREVIEW_W * 0.25, 12)
    ctx.fillStyle = '#fff'
    ctx.fillRect(PREVIEW_W * 0.5, composition.captionY * PREVIEW_H - 6, PREVIEW_W * 0.28, 12)
  }, [composition, source])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const video = videoRef.current
    if (video && Math.abs(video.currentTime - frameTime) > 0.05) video.currentTime = frameTime
  }, [frameTime])

  const point = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = frameRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    }
  }
  const regionFrom = (a: { x: number; y: number }, b: { x: number; y: number }): ContentRegion => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)
  })
  const shown = draft ?? template.webcam

  return (
    <div className="rounded-2xl border border-surface-700 bg-surface-900 p-5" data-testid="stream-template-panel">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <MonitorPlay size={15} className="text-accent-400" />
        Шаблон «Мій стрім»
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        Обведіть мишкою вебку на кадрі зліва — праворуч одразу видно, як виглядатиме кліп у TikTok.
        Шаблон запам’ятається для наступних відео.
      </p>
      <div className="mt-4 flex gap-4">
        <div className="min-w-0 flex-1">
          <div
            ref={frameRef}
            className="relative cursor-crosshair select-none overflow-hidden rounded-lg bg-black"
            style={{ aspectRatio: `${source.width} / ${source.height}` }}
            data-testid="stream-template-frame"
            onPointerDown={(e) => {
              try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no capture */ }
              dragStart.current = point(e)
              setDraft(null)
            }}
            onPointerMove={(e) => { if (dragStart.current) setDraft(regionFrom(dragStart.current, point(e))) }}
            onPointerUp={(e) => {
              const start = dragStart.current
              dragStart.current = null
              if (!start) return
              const region = regionFrom(start, point(e))
              setDraft(null)
              // A click without a drag keeps the current outline.
              if (region.width >= 0.04 && region.height >= 0.04) onChange({ ...template, webcam: region })
            }}
          >
            <video
              ref={videoRef}
              src={window.cutawan.mediaUrl(project.video.path)}
              className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              muted
              preload="auto"
              onLoadedData={(e) => { e.currentTarget.currentTime = frameTime }}
              onSeeked={draw}
            />
            {shown && (
              <div
                className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/15"
                style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }}
              >
                <span className="absolute left-0 top-0 bg-sky-400 px-1 text-[10px] font-semibold text-black">Вебка</span>
              </div>
            )}
          </div>
          <label className="mt-2 block text-[11px] text-zinc-500">
            Кадр для перевірки
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(project.video.durationSec))}
              value={Math.floor(frameTime)}
              onChange={(e) => setFrameTime(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {ZOOMS.map((zoom) => (
              <button
                key={zoom.value}
                type="button"
                onClick={() => onChange({ ...template, gameZoom: zoom.value })}
                className={`rounded-lg border px-2 py-1.5 text-left transition ${
                  template.gameZoom === zoom.value ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                <div className="text-xs font-medium">{zoom.label}</div>
                <div className="text-[10px] leading-snug text-zinc-500">{zoom.hint}</div>
              </button>
            ))}
          </div>
          {template.gameZoom !== 'full' && (
            <label className="mt-2 block text-[11px] text-zinc-500">
              Яку частину гри показувати: ліво ↔ право
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(template.gameFocusX * 100)}
                onChange={(e) => onChange({ ...template, gameFocusX: Number(e.target.value) / 100 })}
                className="mt-1 w-full"
              />
            </label>
          )}
          <div className="mt-2 flex gap-3 text-[11px]">
            {template.webcam ? (
              <button type="button" className="text-zinc-400 underline underline-offset-4 hover:text-zinc-200"
                onClick={() => onChange({ ...template, webcam: null })}>
                Без вебки
              </button>
            ) : (
              <span className="text-amber-300/90">Вебку не вибрано — кліп буде лише з грою.</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-center">
          <canvas
            ref={canvasRef}
            width={PREVIEW_W}
            height={PREVIEW_H}
            className="rounded-lg border border-surface-600"
            data-testid="stream-template-preview"
          />
          <div className="mt-1 text-[10px] text-zinc-500">Кліп 9:16</div>
        </div>
      </div>
    </div>
  )
}
