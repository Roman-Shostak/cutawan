import { Languages } from 'lucide-react'
import type { CaptionLanguage, Project } from '@shared/types'
import { useStore } from '../store'

const OPTIONS: Array<{ value: CaptionLanguage; label: string; hint: string }> = [
  { value: 'uk', label: 'Українською', hint: 'Усе, сказане іншою мовою, перекладається' },
  { value: 'original', label: 'Як говорять', hint: 'Мовою оригіналу, без перекладу' }
]

/**
 * The one language choice the creator makes: captions as spoken, or all in
 * Ukrainian. Saved straight away and used for every video until changed.
 */
export default function CaptionLanguageCard({ project, retranscribe, onRetranscribe }: {
  project: Project
  retranscribe: boolean
  onRetranscribe: (value: boolean) => void
}): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const value = settings?.captionLanguage ?? 'uk'
  const oldTranscript = !!project.transcript && project.transcript.whisperLanguage !== 'auto'

  return (
    <div className="rounded-2xl border border-surface-700 bg-surface-900 p-5" data-testid="caption-language-card">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Languages size={15} className="text-accent-400" />
        Мова субтитрів
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            data-testid={`caption-language-${opt.value}`}
            onClick={() => void saveSettings({ captionLanguage: opt.value })}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              value === opt.value ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 bg-surface-850 text-zinc-400 hover:bg-surface-800'
            }`}
          >
            <div className="text-sm font-medium">{opt.label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">{opt.hint}</div>
          </button>
        ))}
      </div>
      {project.transcript && (
        <label className="mt-3 flex items-start gap-2.5 text-xs text-zinc-400">
          <input type="checkbox" checked={retranscribe} onChange={(e) => onRetranscribe(e.target.checked)} className="mt-0.5" data-testid="retranscribe-toggle" />
          <span>
            Розпізнати мову заново
            <span className="block text-[11px] leading-relaxed text-zinc-500">
              {oldTranscript
                ? 'Розшифровку цього відео зроблено старим способом (одна мова на все відео), через що чужі фрази спотворювались. Рекомендую розпізнати заново.'
                : 'Лише якщо субтитри вийшли з помилками. Розпізнавання займе час.'}
            </span>
          </span>
        </label>
      )}
    </div>
  )
}
