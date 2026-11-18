import { useState } from 'react'
import { DEFAULT_SUBSCRIPTION, type SubscriptionSettings } from '@shared/subscription'
import { useStore } from '../store'
import LocalWhisperSetup from './LocalWhisperSetup'
import OpenRouterSetup, { type OpenRouterChoice } from './OpenRouterSetup'
import { DEFAULT_OPENROUTER_MODEL, DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL } from '@shared/openrouter'

type Route = 'api' | 'chatgpt' | 'local' | 'openrouter'
const SETUP_ROUTE_KEY = 'cutawan.setupRoute.v1'

export default function SetupWizard(): React.JSX.Element {
  const settings = useStore(s => s.settings)
  const saveSettings = useStore(s => s.saveSettings)
  const [route, setRoute] = useState<Route | null>(() => {
    const saved = window.localStorage.getItem(SETUP_ROUTE_KEY)
    if (saved === 'api' || saved === 'chatgpt' || saved === 'local' || saved === 'openrouter') return saved
    if (settings?.subscription.provider === 'chatgpt') return 'chatgpt'
    if (settings?.subscription.provider === 'openrouter') return 'openrouter'
    if (settings?.hasApiKey) return 'api'
    if (settings?.subscription.whisperModelPath) return 'local'
    return null
  })
  const [subscription, setSubscription] = useState<SubscriptionSettings>(settings?.subscription ?? DEFAULT_SUBSCRIPTION)
  const [apiKey, setApiKey] = useState('')
  const [openRouter, setOpenRouter] = useState<OpenRouterChoice>({
    apiKey: '',
    model: settings?.openRouterModel ?? DEFAULT_OPENROUTER_MODEL,
    transcriptionModel: settings?.openRouterTranscriptionModel ?? DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL
  })
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const chooseRoute = (next: Route): void => {
    window.localStorage.setItem(SETUP_ROUTE_KEY, next)
    setRoute(next)
    setVerified(false)
    setMessage('')
  }
  const updateSubscription = (patch: Partial<SubscriptionSettings>): void => {
    setSubscription(current => ({ ...current, ...patch }))
    setVerified(false)
    setMessage('')
  }
  const check = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await saveSettings({ subscription: { ...subscription, provider: 'chatgpt' } })
      const result = await window.cutawan.checkSubscriptionSetup()
      setVerified(true)
      setMessage(result.message)
    } catch (error) {
      setVerified(false)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  const checkLocal = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await saveSettings({ subscription: { ...subscription, provider: 'api', localTranscription: true } })
      const result = await window.cutawan.checkLocalWhisperSetup()
      setVerified(true)
      setMessage(result.message)
    } catch (error) {
      setVerified(false)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  const finish = async (skip = false): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await saveSettings({
        setupComplete: true,
        ...(skip ? {} : route === 'chatgpt'
          ? { subscription: { ...subscription, provider: 'chatgpt' as const } }
          : route === 'local'
            ? { subscription: { ...subscription, provider: 'api' as const, localTranscription: true } }
          : route === 'openrouter'
            ? {
                subscription: { ...subscription, provider: 'openrouter' as const },
                openRouterModel: openRouter.model,
                openRouterTranscriptionModel: openRouter.transcriptionModel,
                ...(openRouter.apiKey.trim() ? { openRouterKey: openRouter.apiKey.trim() } : {})
              }
          : { subscription: { ...subscription, provider: 'api' as const }, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      })
      window.localStorage.removeItem(SETUP_ROUTE_KEY)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  return <div className="fixed inset-0 z-[60] overflow-y-auto px-5 py-10 text-zinc-100" style={{ backgroundColor: '#09090b' }}>
    <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl shadow-black/70 sm:p-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">Вітаємо в Cutawan</p>
        <h1 className="mt-2 text-3xl font-bold">Виберіть, як створюватимуться кліпи</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Виберіть підключення до ШІ для пошуку кліпів. Його можна змінити пізніше в Налаштуваннях. Монтаж і експорт відбуваються на вашому комп’ютері.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => chooseRoute('chatgpt')}
          className={`rounded-xl border p-4 text-left ${route === 'chatgpt' ? 'border-accent-400 bg-accent-400/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">Вхід через ChatGPT</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Codex для аналізу й локальний Whisper для мови. Без API-ключа OpenAI.</span>
        </button>
        <button type="button" onClick={() => chooseRoute('api')}
          className={`rounded-xl border p-4 text-left ${route === 'api' ? 'border-accent-400 bg-accent-400/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">OpenAI-сумісний API</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">API-ключ і сумісна адреса (OpenAI, Anthropic тощо). Використання API оплачується окремо.</span>
        </button>
        <button type="button" onClick={() => chooseRoute('local')}
          className={`rounded-xl border p-4 text-left ${route === 'local' ? 'border-accent-400 bg-accent-400/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">Лише локальні субтитри</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Розпізнавання й субтитри для цілих відео без ШІ-сервісу. Для пошуку кліпів підключення знадобиться пізніше.</span>
        </button>
        <button type="button" onClick={() => chooseRoute('openrouter')} data-testid="setup-route-openrouter"
          className={`rounded-xl border p-4 text-left ${route === 'openrouter' ? 'border-accent-400 bg-accent-400/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">OpenRouter</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Один ключ для сотень моделей від OpenAI, Anthropic, Google та інших. Оплата за використання.</span>
        </button>
      </div>

      {route === 'chatgpt' && <div className="mt-5 space-y-4 rounded-xl border border-surface-600 bg-surface-900 p-5">
        <div>
          <h2 className="text-base font-semibold">ChatGPT + локальний Whisper</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Встановіть Codex CLI, виконайте <code>codex login</code> і виберіть вхід через ChatGPT. Діють ліміти Codex вашого тарифу. Cutawan ніколи не читає ваші токени входу й не перемикається непомітно на платний API.
          </p>
          <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">Інструкція зі встановлення Codex ↗</a>
        </div>
        <label className="block text-xs">Виконуваний файл Codex
          <input value={subscription.codexPath} onChange={e => updateSubscription({ codexPath: e.target.value })}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs">Виконуваний файл Python (Python 3.10+)
          <input value={subscription.pythonPath} onChange={e => updateSubscription({ pythonPath: e.target.value })}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <LocalWhisperSetup pythonPath={subscription.pythonPath} onConfigured={(pythonPath, whisperModelPath) => updateSubscription({ pythonPath, whisperModelPath })} />
        <label className="block text-xs">Папка моделі Whisper (якщо вже встановлена)
          <input value={subscription.whisperModelPath} onChange={e => updateSubscription({ whisperModelPath: e.target.value })}
            placeholder="Папка з файлом model.bin" className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <p className="text-xs text-zinc-500">За замовчуванням: Luna, низький рівень міркувань, ліміт 10 нових запитів на добу (UTC). Відео може потребувати більше — змініть ліміт у Налаштуваннях. Перевірка не робить запитів до ШІ.</p>
        <button type="button" onClick={() => void check()} disabled={busy}
          className="rounded-lg border border-surface-600 px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Перевіряю…' : 'Перевірити підключення й Whisper'}</button>
        {verified && <p className="text-xs text-emerald-400">Готово до старту.</p>}
      </div>}

      {route === 'api' && <div className="mt-5 rounded-xl border border-surface-600 bg-surface-900 p-5">
        <h2 className="text-base font-semibold">Підключення до API</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Підписка ChatGPT не включає використання API. Цей варіант оплачує розпізнавання й аналіз окремо через API. Іншу OpenAI-сумісну адресу (наприклад Anthropic) можна вказати пізніше в Налаштуваннях.
        </p>
        <label className="mt-4 block text-xs">API-ключ
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={settings?.hasApiKey ? 'Ключ уже налаштовано' : 'sk-…'}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">Створити API-ключ ↗</a>
        <label className="mt-5 flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={subscription.localTranscription} onChange={e => updateSubscription({ localTranscription: e.target.checked })} />
          Розпізнавати мову локально замість API розпізнавання
        </label>
        {subscription.localTranscription && <div className="mt-4 space-y-3">
          <label className="block text-xs">Виконуваний файл Python (Python 3.10+)
            <input value={subscription.pythonPath} onChange={e => updateSubscription({ pythonPath: e.target.value })}
              className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
          </label>
          <LocalWhisperSetup pythonPath={subscription.pythonPath} onConfigured={(pythonPath, whisperModelPath) => updateSubscription({ pythonPath, whisperModelPath })} />
          <label className="block text-xs">Папка моделі Whisper (якщо вже встановлена)
            <input value={subscription.whisperModelPath} onChange={e => updateSubscription({ whisperModelPath: e.target.value })}
              placeholder="Папка з файлом model.bin" className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
          </label>
        </div>}
      </div>}

      {route === 'local' && <div className="mt-5 space-y-4 rounded-xl border border-surface-600 bg-surface-900 p-5">
        <div>
          <h2 className="text-base font-semibold">Лише локальні субтитри</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Субтитри на все відео, обрізка й експорт без API-ключа. Цей варіант не шукає й не оцінює яскраві моменти.
          </p>
        </div>
        <label className="block text-xs">Виконуваний файл Python (Python 3.10+)
          <input value={subscription.pythonPath} onChange={e => updateSubscription({ pythonPath: e.target.value })}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <LocalWhisperSetup pythonPath={subscription.pythonPath} onConfigured={(pythonPath, whisperModelPath) => updateSubscription({ pythonPath, whisperModelPath })} />
        <label className="block text-xs">Папка моделі Whisper (якщо вже встановлена)
          <input value={subscription.whisperModelPath} onChange={e => updateSubscription({ whisperModelPath: e.target.value })}
            placeholder="Папка з файлом model.bin" className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={() => void checkLocal()} disabled={busy}
          className="rounded-lg border border-surface-600 px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Перевіряю…' : 'Перевірити локальний Whisper'}</button>
        {verified && <p className="text-xs text-emerald-400">Готово до локальних субтитрів.</p>}
      </div>}

      {route === 'openrouter' && <div className="mt-5 space-y-4 rounded-xl border border-surface-600 bg-surface-900 p-5">
        <div>
          <h2 className="text-base font-semibold">Підключення OpenRouter</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Виберіть модель для пошуку кліпів і спосіб розпізнавання мови. Обидва можна змінити пізніше в Налаштуваннях.
          </p>
        </div>
        <OpenRouterSetup value={openRouter} onChange={patch => { setOpenRouter(current => ({ ...current, ...patch })); setMessage('') }}
          subscription={subscription} onSubscriptionChange={updateSubscription} />
      </div>}

      {message && <p role="status" className="mt-4 text-xs text-zinc-300">{message}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => void finish(true)} disabled={busy} className="text-xs text-zinc-400 underline disabled:opacity-50">Переглянути без налаштування</button>
        <button type="button" onClick={() => void finish()} disabled={busy || route === null || ((route === 'chatgpt' || route === 'local') && !verified) || (route === 'api' && !apiKey.trim() && !settings?.hasApiKey)
            || (route === 'openrouter' && !openRouter.apiKey.trim() && !settings?.hasOpenRouterKey)}
          className="rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-40">Почати роботу з Cutawan</button>
      </div>
    </div>
  </div>
}
