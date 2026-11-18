import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { Clip, GameDialogueLine, Project } from '@shared/types'
import { gameLinesInClip, gameSubtitlesEnabled } from '@shared/gameDialogue'
import { usePreviewBus } from '../lib/previewBus'
import { useStore } from '../store'
import { formatTimecode } from '../lib/format'

/**
 * Per-clip control over the translated game dialogue: switch it off for the
 * whole clip, or hide single lines (the game talking over a funny moment
 * with a friend). Hiding is per clip; editing a translation fixes the line
 * everywhere it appears.
 */
export default function GameDialogueEditor({
  project,
  clip,
  onEdit
}: {
  project: Project
  clip: Clip
  onEdit: (edit: Partial<Clip['edit']>) => void
}): React.JSX.Element {
  const dialogue = project.gameDialogue
  const lines = gameLinesInClip(clip, dialogue)
  const enabled = gameSubtitlesEnabled(clip, dialogue)
  const hidden = new Set(clip.edit.hiddenGameLines ?? [])
  const shown = lines.filter((l) => !hidden.has(l.id) && l.translation.trim()).length

  const setHidden = (next: Set<string>): void => {
    // Keep ids of lines outside the current trim too: widening the trim later
    // should not bring back a line the user already hid.
    onEdit({ hiddenGameLines: [...next] })
  }

  if (!dialogue || dialogue.lines.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-zinc-500">
        У цьому проєкті немає діалогів гри. Запишіть у OBS окрему доріжку звуку гри й виберіть її в блоці «Аудіодоріжки» перед генерацією кліпів.
      </p>
    )
  }

  return (
    <div data-testid="game-dialogue-editor">
      <ToggleRow
        label="Показувати діалоги гри"
        checked={clip.edit.gameSubtitles !== false}
        onChange={(v) => onEdit({ gameSubtitles: v })}
      />
      {lines.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-500">У межах цього кліпу гра нічого не говорить.</p>
      ) : enabled && (
        <>
          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
            <span>Показано {shown} з {lines.length}</span>
            <span className="flex gap-3">
              <button className="hover:text-zinc-200" onClick={() => setHidden(new Set([...hidden, ...lines.map((l) => l.id)]))}>
                Приховати всі
              </button>
              <button className="hover:text-zinc-200" onClick={() => {
                const next = new Set(hidden)
                lines.forEach((l) => next.delete(l.id))
                setHidden(next)
              }}>
                Показати всі
              </button>
            </span>
          </div>
          <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {lines.map((line) => (
              <LineRow
                // Remount on a saved change so the draft picks up the new text.
                key={`${line.id}:${line.translation}`}
                line={line}
                hidden={hidden.has(line.id)}
                onToggle={() => {
                  const next = new Set(hidden)
                  if (next.has(line.id)) next.delete(line.id)
                  else next.add(line.id)
                  setHidden(next)
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Натисніть на час, щоб перейти до репліки. Виправлений переклад зберігається для всіх кліпів.
          </p>
        </>
      )}
    </div>
  )
}

function LineRow({ line, hidden, onToggle }: {
  line: GameDialogueLine
  hidden: boolean
  onToggle: () => void
}): React.JSX.Element {
  const seek = usePreviewBus((s) => s.seek)
  const active = usePreviewBus((s) => s.time >= line.start && s.time < line.end)
  const updateGameLine = useStore((s) => s.updateGameLine)
  const [draft, setDraft] = useState(line.translation)

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 transition ${
        active ? 'border-white/30 bg-white/[0.05]' : 'border-surface-600'
      } ${hidden ? 'opacity-45' : ''}`}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={() => seek(line.start)}
          className="font-mono text-[10px] text-zinc-500 hover:text-zinc-200"
        >
          {formatTimecode(line.start)}
        </button>
        {line.text !== line.translation && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-600" title={line.text}>{line.text}</span>
        )}
        <button
          onClick={onToggle}
          className="ml-auto shrink-0 rounded p-1 text-zinc-400 hover:bg-surface-800 hover:text-zinc-100"
          title={hidden ? 'Показати репліку' : 'Приховати репліку'}
          aria-label={hidden ? 'Показати репліку' : 'Приховати репліку'}
        >
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      <textarea
        value={draft}
        rows={Math.min(3, Math.max(1, Math.ceil(draft.length / 38)))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== line.translation) void updateGameLine(line.id, draft) }}
        className={`mt-1 w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-200 focus:border-surface-600 focus:bg-surface-850 focus:outline-none ${
          hidden ? 'line-through' : ''
        }`}
      />
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-surface-600 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
    >
      {label}
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-zinc-100' : 'bg-surface-600'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${checked ? 'left-[18px] bg-zinc-900' : 'left-0.5 bg-white'}`} />
      </span>
    </button>
  )
}
