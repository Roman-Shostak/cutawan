import { useState } from 'react'
import type { SubscriptionSettings as Preferences } from '@shared/subscription'
import LocalWhisperSetup from './LocalWhisperSetup'

export default function SubscriptionSettings({ value, onChange, onSave }: {
  value: Preferences
  onChange: (value: Preferences) => void
  onSave: () => Promise<void>
}): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const update = (patch: Partial<Preferences>): void => {
    setMessage('')
    onChange({ ...value, ...patch })
  }
  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      await onSave()
      const result = await window.cutawan.checkSubscriptionSetup()
      setMessage(`${result.message} Сьогодні використано запитів: ${result.requestsToday}.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setChecking(false) }
  }
  const checkLocal = async (): Promise<void> => {
    setChecking(true)
    try {
      await onSave()
      const result = await window.cutawan.checkLocalWhisperSetup()
      setMessage(result.message)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setChecking(false) }
  }
  const inputClass = 'mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm'
  return <div className="mb-6 space-y-3">
    <label className="block text-sm font-medium" htmlFor="analysis-provider">Підключення до ШІ</label>
    <select id="analysis-provider" value={value.provider} onChange={e => update({ provider: e.target.value as Preferences['provider'] })} className={inputClass}>
      <option value="api">OpenAI-сумісний API</option>
      <option value="openrouter">OpenRouter</option>
      <option value="chatgpt">Підписка ChatGPT через Codex (бета)</option>
    </select>
    {value.provider === 'api' && <>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={value.localTranscription} onChange={e => update({ localTranscription: e.target.checked })} />
        Розпізнавати мову локально через Whisper (аналіз усе одно через API)
      </label>
      {value.localTranscription && <>
        <label className="block text-xs" htmlFor="api-python-path">Виконуваний файл Python
          <input id="api-python-path" className={inputClass} value={value.pythonPath} onChange={e => update({ pythonPath: e.target.value })} />
        </label>
        <LocalWhisperSetup pythonPath={value.pythonPath} onConfigured={(pythonPath, whisperModelPath) => update({ pythonPath, whisperModelPath })} />
        <label className="block text-xs" htmlFor="api-whisper-path">Папка моделі Whisper
          <input id="api-whisper-path" className={inputClass} value={value.whisperModelPath} onChange={e => update({ whisperModelPath: e.target.value })} placeholder="Папка з файлом model.bin" />
        </label>
        <button type="button" onClick={() => void checkLocal()} disabled={checking} className="rounded-lg border border-surface-600 px-3 py-2 text-sm disabled:opacity-50">{checking ? 'Перевіряю…' : 'Зберегти й перевірити локальний Whisper'}</button>
        {message && <p role="status" className="text-xs leading-relaxed text-zinc-300">{message}</p>}
      </>}
    </>}
    {value.provider === 'chatgpt' && <>
      <p className="text-xs leading-relaxed text-zinc-400">Аналіз через ваш вхід у ChatGPT, розпізнавання — локальним Whisper. Потрібні Codex CLI, Python з faster-whisper і завантажена модель мови. Діють ліміти підписки; API-ключ не потрібен.</p>
      <p className="text-xs leading-relaxed text-zinc-400">Встановіть Codex CLI і один раз виконайте <code>codex login</code>, щоб увійти через ChatGPT. Cutawan ніколи не читає й не зберігає ваші токени входу. Текст розшифровки й вибрані кадри надсилаються в Codex; аудіо розпізнається на цьому комп’ютері.</p>
      <a className="block text-xs underline" href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">Встановлення Codex і вхід</a>
      <a className="block text-xs underline" href="https://github.com/JeremySNR/cutawan/blob/main/docs/chatgpt-subscription.md" target="_blank" rel="noreferrer">Інструкція з локального розпізнавання</a>
      <label className="block text-xs" htmlFor="codex-path">Виконуваний файл Codex
        <input id="codex-path" className={inputClass} value={value.codexPath} onChange={e => update({ codexPath: e.target.value })} />
      </label>
      <label className="block text-xs" htmlFor="codex-model">Модель аналізу
        <input id="codex-model" className={inputClass} value={value.codexModel} onChange={e => update({ codexModel: e.target.value })} />
      </label>
      <p className="text-xs text-zinc-500">За замовчуванням Luna з низьким рівнем міркувань. Доступність моделей залежить від вашого акаунта; недоступна модель дає помилку, а не автоматичну заміну.</p>
      <label className="block text-xs" htmlFor="request-limit">Максимум нових запитів на добу (UTC)
        <input id="request-limit" type="number" min={0} max={500} className={inputClass} value={value.dailyRequestLimit} onChange={e => update({ dailyRequestLimit: Number(e.target.value) })} />
      </label>
      <p className="text-xs text-zinc-500">Одне відео може потребувати багато запитів. Результати з кешу не рахуються. Поставте 0, щоб працювати лише з кешем. Це ліміт запитів, а не токенів чи налаштувань витрат акаунта.</p>
      <label className="block text-xs" htmlFor="python-path">Виконуваний файл Python зі встановленим faster-whisper
        <input id="python-path" className={inputClass} value={value.pythonPath} onChange={e => update({ pythonPath: e.target.value })} />
      </label>
      <LocalWhisperSetup pythonPath={value.pythonPath} onConfigured={(pythonPath, whisperModelPath) => update({ pythonPath, whisperModelPath })} />
      <label className="block text-xs" htmlFor="whisper-path">Папка завантаженої моделі faster-whisper
        <input id="whisper-path" className={inputClass} value={value.whisperModelPath} onChange={e => update({ whisperModelPath: e.target.value })} placeholder="Папка з файлом model.bin" />
      </label>
      <button type="button" onClick={() => void check()} disabled={checking} className="rounded-lg border border-surface-600 px-3 py-2 text-sm disabled:opacity-50">{checking ? 'Перевіряю…' : 'Зберегти й перевірити (без запиту до ШІ)'}</button>
      {message && <p role="status" className="text-xs leading-relaxed text-zinc-300">{message}</p>}
    </>}
  </div>
}
