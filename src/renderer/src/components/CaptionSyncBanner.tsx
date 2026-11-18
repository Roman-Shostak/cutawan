import { Loader2 } from 'lucide-react'
import { useStore } from '../store'

/** Shown while the open project's captions are translated (or restored). */
export default function CaptionSyncBanner(): React.JSX.Element | null {
  const busy = useStore((s) => s.captionSync !== null && s.captionSync === s.project?.id)
  const language = useStore((s) => s.settings?.captionLanguage ?? 'uk')
  if (!busy) return null
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl border border-surface-600 bg-surface-900 px-4 py-2.5 text-xs text-zinc-300" data-testid="caption-sync-banner">
      <Loader2 size={14} className="animate-spin" />
      {language === 'uk' ? 'Перекладаю субтитри українською… Зачекайте перед експортом.' : 'Повертаю субтитри мовою оригіналу…'}
    </div>
  )
}
