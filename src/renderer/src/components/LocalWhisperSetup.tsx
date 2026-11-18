import { useEffect, useState } from 'react'
import type { ImportProgress } from '@shared/types'

export default function LocalWhisperSetup({ pythonPath, onConfigured }: {
  pythonPath: string
  onConfigured: (pythonPath: string, modelPath: string) => void
}): React.JSX.Element {
  const [model, setModel] = useState<'small' | 'large-v3'>('small')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [savedInstall, setSavedInstall] = useState<'checking' | 'ready' | 'missing' | 'error'>('checking')

  useEffect(() => window.cutawan.onLocalWhisperInstallProgress(setProgress), [])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const settings = await window.cutawan.getSettings()
        if (!settings.subscription.whisperModelPath) {
          if (active) setSavedInstall('missing')
          return
        }
        await window.cutawan.checkLocalWhisperSetup()
        if (active) setSavedInstall('ready')
      } catch (error) {
        if (active) {
          setSavedInstall('error')
          setMessage(`Збережене налаштування Whisper потребує уваги: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })()
    return () => { active = false }
  }, [])

  const install = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    setSavedInstall('checking')
    setProgress({ progress: 0, message: 'Починаю локальне встановлення…' })
    try {
      const result = await window.cutawan.installLocalWhisper(model, pythonPath)
      onConfigured(result.pythonPath, result.modelPath)
      setSavedInstall('ready')
      setMessage('Whisper встановлено й готово. Розпізнавання працюватиме на цьому комп’ютері.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return <div className="rounded-xl border border-surface-600 bg-surface-850 p-4">
    <h3 className="text-sm font-semibold">Локальний Whisper</h3>
    {savedInstall === 'checking' && !busy && <p role="status" className="mt-2 text-xs text-zinc-400">Шукаю наявне встановлення…</p>}
    {savedInstall === 'ready' && <p role="status" className="mt-2 text-xs text-emerald-400">Встановлено й готово на цьому комп’ютері. Завантажувати повторно не потрібно.</p>}
    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
      Потрібен встановлений Python 3.10+. Створюється окреме середовище в даних Cutawan, встановлюється faster-whisper і завантажується модель із Hugging Face. Нічого не завантажується, доки ви не натиснете «Встановити».
    </p>
    <label className="mt-3 block text-xs" htmlFor="whisper-install-model">Модель мови</label>
    <select id="whisper-install-model" value={model} onChange={e => setModel(e.target.value as typeof model)}
      disabled={busy} className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-900 px-3 py-2 text-sm">
      <option value="small">Small — швидша, менше завантаження</option>
      <option value="large-v3">Large v3 — точніша, завантаження на кілька ГБ</option>
    </select>
    <div className="mt-3 flex gap-2">
      <button type="button" onClick={() => void install()} disabled={busy}
        className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50">
        {busy ? 'Встановлюю…' : savedInstall === 'ready' ? 'Перевстановити або змінити модель' : 'Встановити локальний Whisper'}
      </button>
      {busy && <button type="button" onClick={() => void window.cutawan.cancelLocalWhisperInstall()}
        className="rounded-lg border border-surface-600 px-3 py-2 text-sm">Скасувати</button>}
    </div>
    {progress && <p role="status" className="mt-2 text-xs text-zinc-400">
      {progress.progress >= 0 ? `${Math.round(progress.progress * 100)}% · ` : ''}{progress.message}
    </p>}
    {message && <p role="status" className="mt-2 text-xs text-zinc-300">{message}</p>}
  </div>
}
