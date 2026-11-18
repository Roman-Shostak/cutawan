import { AudioLines } from 'lucide-react'
import type { AudioRouting, AudioTrackInfo, Project } from '@shared/types'

/**
 * Track roles for multi-track recordings (OBS: 1 = mix, 2 = mic, 3 = game).
 * Only shown when the file has more than one audio track; with a single
 * track there is nothing to choose and game subtitles are unavailable.
 */

export function defaultAudioRouting(project: Project): AudioRouting | null {
  const tracks = project.video.audioTracks ?? []
  if (tracks.length < 2) return null
  if (project.audioRouting && project.audioRouting.voiceTrack < tracks.length &&
    (project.audioRouting.gameTrack === null || project.audioRouting.gameTrack < tracks.length)) {
    return project.audioRouting
  }
  // An existing transcript keeps its track, so opening an older project never
  // silently costs a second transcription; a fresh OBS recording
  // (1 = mix, 2 = mic, 3 = game) starts from the mic and the game track.
  const preferred: AudioRouting = tracks.length >= 3 ? { voiceTrack: 1, gameTrack: 2 } : { voiceTrack: 0, gameTrack: 1 }
  if (!project.transcript) return preferred
  const voiceTrack = project.transcript.audioTrack ?? 0
  const gameTrack = preferred.gameTrack !== voiceTrack ? preferred.gameTrack
    : tracks.findIndex((_, i) => i !== voiceTrack && i !== 0)
  return { voiceTrack, gameTrack: gameTrack !== null && gameTrack >= 0 ? gameTrack : null }
}

function trackLabel(track: AudioTrackInfo, position: number): string {
  const name = track.title ? ` — ${track.title}` : ''
  const channels = track.channels === 1 ? ', моно' : track.channels === 2 ? ', стерео' : ''
  return `Доріжка ${position + 1}${name}${channels}`
}

export default function AudioTracksPanel({
  project,
  routing,
  onRoutingChange,
  gameContext,
  onGameContextChange
}: {
  project: Project
  routing: AudioRouting
  onRoutingChange: (routing: AudioRouting) => void
  gameContext: string
  onGameContextChange: (context: string) => void
}): React.JSX.Element {
  const tracks = project.video.audioTracks ?? []
  const select =
    'mt-1.5 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm text-zinc-200 focus:border-white/25 focus:outline-none'
  const savedTrack = project.transcript?.audioTrack ?? 0
  const retranscribe = project.transcript !== null && savedTrack !== routing.voiceTrack

  return (
    <div className="rounded-2xl border border-surface-700 bg-surface-900 p-5" data-testid="audio-tracks-panel">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AudioLines size={15} className="text-accent-400" />
        Аудіодоріжки
        <span className="font-normal text-zinc-500">({tracks.length} у файлі)</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        Субтитри будуються з доріжки голосу. Якщо вибрати доріжку гри, її діалоги розпізнаються окремо
        й з’являться вгорі кадру перекладом. У кожному кліпі їх можна вимкнути або прибрати окремі репліки.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-zinc-300">
          Твій голос
          <select
            className={select}
            value={routing.voiceTrack}
            data-testid="voice-track-select"
            onChange={(e) => {
              const voiceTrack = Number(e.target.value)
              onRoutingChange({
                voiceTrack,
                gameTrack: routing.gameTrack === voiceTrack ? null : routing.gameTrack
              })
            }}
          >
            {tracks.map((track, i) => (
              <option key={track.index} value={i}>{trackLabel(track, i)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-300">
          Звук гри
          <select
            className={select}
            value={routing.gameTrack ?? -1}
            data-testid="game-track-select"
            onChange={(e) => {
              const value = Number(e.target.value)
              onRoutingChange({ ...routing, gameTrack: value < 0 ? null : value })
            }}
          >
            <option value={-1}>Немає (без субтитрів гри)</option>
            {tracks.map((track, i) => i === routing.voiceTrack ? null : (
              <option key={track.index} value={i}>{trackLabel(track, i)}</option>
            ))}
          </select>
        </label>
      </div>
      {routing.gameTrack !== null && (
        <label className="mt-3 block text-xs font-medium text-zinc-300">
          Гра <span className="font-normal text-zinc-500">(необов’язково — допомагає правильно перекладати імена)</span>
          <input
            value={gameContext}
            onChange={(e) => onGameContextChange(e.target.value)}
            placeholder="напр. «The Last of Us Part II» або «Metro Exodus, рос. озвучка»"
            className="mt-1.5 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            data-testid="game-context-input"
          />
        </label>
      )}
      {retranscribe && (
        <p className="mt-3 text-[11px] text-amber-400/90">
          Збережену розшифровку зроблено з іншої доріжки — голос буде розпізнано заново.
        </p>
      )}
    </div>
  )
}
