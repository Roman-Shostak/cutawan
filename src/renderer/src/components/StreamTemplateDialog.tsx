import { useState } from 'react'
import { X } from 'lucide-react'
import type { Project, StreamTemplate } from '@shared/types'
import { DEFAULT_STREAM_TEMPLATE, normalizeStreamTemplate } from '@shared/composition'
import { applyStreamTemplate, clipStreamTemplate } from '@shared/streamLayout'
import { useStore } from '../store'
import StreamTemplatePanel from './StreamTemplatePanel'

/**
 * Put clips that already exist on the "My stream" template — for projects
 * cut before the template existed, or analysed as another video type —
 * without generating the clips again.
 */
export default function StreamTemplateDialog({ project, onClose }: {
  project: Project
  onClose: () => void
}): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const updateClip = useStore((s) => s.updateClip)
  const saveSettings = useStore((s) => s.saveSettings)
  const [template, setTemplate] = useState<StreamTemplate>(() =>
    project.clips.map(clipStreamTemplate).find(Boolean) ??
    normalizeStreamTemplate(settings?.streamTemplate) ??
    DEFAULT_STREAM_TEMPLATE)
  const [busy, setBusy] = useState(false)

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      for (const clip of project.clips) await updateClip(applyStreamTemplate(clip, template, project.video))
      await saveSettings({ streamTemplate: template })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl border border-surface-600 bg-surface-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Шаблон «Мій стрім»"
        data-testid="stream-template-dialog"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Застосувати шаблон «Мій стрім» до кліпів</div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-surface-800 hover:text-zinc-100" aria-label="Закрити">
            <X size={16} />
          </button>
        </div>
        <StreamTemplatePanel project={project} template={template} onChange={setTemplate} />
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          Усі {project.clips.length} кліпи отримають цей вигляд: вебка зверху, гра знизу. Щільний монтаж вимкнеться — у грі паузи часто
          найнапруженіші. Обрізка, субтитри й назви не зміняться.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-surface-600 px-4 py-2 text-sm text-zinc-300 hover:bg-surface-800">
            Скасувати
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
            data-testid="stream-template-apply"
          >
            {busy ? 'Застосовую…' : 'Застосувати до всіх кліпів'}
          </button>
        </div>
      </div>
    </div>
  )
}
