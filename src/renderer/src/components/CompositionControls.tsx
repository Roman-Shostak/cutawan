import { useState } from 'react'
import type { Clip, Composition, ContentRegion, StreamTemplate } from '@shared/types'
import { applyStreamTemplate, clipStreamTemplate } from '@shared/streamLayout'
import { isPresenterComposition, presenterComposition } from '@shared/composition'
import { compositionHidesTitle, layoutReviewMessage, layoutShotAt, validLayoutShots } from '@shared/contentType'
import { usePreviewBus } from '../lib/previewBus'
import { useStore } from '../store'

const preferences = [
  ['auto', 'Автоматично'], ['content-first', 'Спершу контент'], ['stacked', 'Одне над одним'], ['content-only', 'Лише контент']
] as const
const startingRegions = presenterComposition({ x: .05, y: .35, width: .75, height: .6 },
  { x: .82, y: .02, width: .16, height: .28 })!

export default function CompositionControls({ clip }: { clip: Clip }): React.JSX.Element | null {
  const [adding, setAdding] = useState(false)
  const shot = usePreviewBus(s => layoutShotAt(clip, s.time))
  const update = useStore(s => s.updateClip)
  const retry = useStore(s => s.ensureReframe)
  const busy = useStore(s => s.reframeBusy[clip.id])
  const error = useStore(s => s.reframeError[clip.id])
  const streamTemplate = clipStreamTemplate(clip)
  const hasComposition = !streamTemplate && clip.visualLayout?.shots?.some(s => isPresenterComposition(s.composition))
  const hasSplits = clip.visualLayout?.shots?.some(s => s.composition?.preset === 'speakers')
  const splitsOn = clip.edit.speakerSplit !== false
  const issue = layoutReviewMessage(clip)
  const active = clip.edit.aspect === '9:16' && clip.edit.framing === 'auto' && clip.edit.reframeMode === 'crop'
  const saveRegions = (composition: Composition): void => {
    const layout = clip.visualLayout
    const existing = validLayoutShots(layout, clip.edit.start, clip.edit.end)
    const replacement = { start: shot?.start ?? clip.edit.start, end: shot?.end ?? clip.edit.end, mode: 'fit' as const,
      composition, review: { status: 'needs-review' as const, reason: 'Області джерела задано вручну; перегляньте цей план перед експортом.' } }
    void update({ ...clip, edit: { ...clip.edit, layoutChosen: true, framing: 'auto', reframeMode: 'crop', autoZoom: false },
      visualLayout: { start: existing ? layout!.start : clip.edit.start, end: existing ? layout!.end : clip.edit.end,
        preserveContext: true, allowZoom: false, reason: 'Області джерела вибрано вручну.', revision: (layout?.revision ?? 0) + 1,
        shots: existing && shot ? layout!.shots!.map(s => s === shot ? replacement : s)
          : [{ ...replacement, start: clip.edit.start, end: clip.edit.end }] } })
    setAdding(false)
  }
  if (streamTemplate) return <StreamClipControls clip={clip} template={streamTemplate} active={active} />
  return <div className="mt-3 space-y-2">
    {issue && <p className="text-xs text-amber-300">Перевірка компонування: {issue}</p>}
    {issue && !clip.edit.layoutChosen && !clip.visualLayout?.revision && <div className="space-y-1">
      <button type="button" disabled={busy} onClick={() => void retry(clip.id, true)}
        className="text-xs text-zinc-300 underline underline-offset-4 disabled:opacity-40">
        {busy ? 'Повторюю компонування…' : 'Повторити автоматичне компонування'}
      </button>
      <p className="text-[11px] text-zinc-500">Перевіряє кліп через ваш ШІ-провайдер. Розшифровка й вибір кліпу зберігаються.</p>
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    </div>}
    {hasSplits && clip.edit.aspect === '9:16' && <div className="space-y-1">
      <button type="button" aria-pressed={splitsOn}
        onClick={() => void update({ ...clip, edit: { ...clip.edit, speakerSplit: !splitsOn } })}
        className={`w-full rounded-lg border px-2 py-2 text-xs transition ${splitsOn ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 text-zinc-400 hover:bg-surface-800'}`}>
        Розділений екран під час розмов: {splitsOn ? 'on' : 'off'}
      </button>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Показує обох людей одне над одним, коли вони швидко обмінюються репліками в одному кадрі. Якщо вимкнено — камера стежить за тим, хто говорить.
      </p>
    </div>}
    {hasComposition && <>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Компонування ведучого й контенту">
        {preferences.map(([value, label]) => <button key={value} type="button"
          aria-pressed={active && (clip.edit.compositionPreference ?? 'auto') === value}
          disabled={clip.edit.aspect !== '9:16'}
          onClick={() => void update({ ...clip, edit: { ...clip.edit, layoutChosen: true, compositionPreference: value, framing: 'auto', reframeMode: 'crop', autoZoom: false } })}
          className={`rounded-lg border px-2 py-2 text-xs transition disabled:opacity-40 ${active && (clip.edit.compositionPreference ?? 'auto') === value ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 text-zinc-400 hover:bg-surface-800'}`}>
          {label}
        </button>)}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        {clip.edit.aspect !== '9:16' ? 'Компонування з ведучим доступне у 9:16. Інші формати зберігають усю сцену.' :
          'Окремі кропи з оригінального відео. Автоматичне компонування перевіряється на вибіркових кадрах; перегляньте рух перед експортом.'}
      </p>
      {compositionHidesTitle(clip) && clip.edit.showTitle && <p className="text-[11px] text-zinc-500">Заголовок-гачок приховано, щоб не закривати ведучого.</p>}
      {active && isPresenterComposition(shot?.composition) && <RegionForm key={`${shot!.start}:${JSON.stringify(shot!.composition)}`}
        composition={shot!.composition!} onSave={saveRegions} />}
    </>}
    {clip.edit.aspect === '9:16' && !shot?.composition && <>
      <button type="button" className="text-xs text-zinc-400 underline underline-offset-4" onClick={() => setAdding(!adding)}>
        {adding ? 'Скасувати області джерела' : 'Задати області ведучого й контенту'}
      </button>
      {adding && <>
        <p className="text-[11px] text-zinc-500">Для окремої вставки ведучого (вебки) і контенту екрана (гри). Підлаштуйте ці області під своє відео; аналіз ШІ не потрібен.</p>
        <RegionForm composition={startingRegions} onSave={saveRegions} open />
      </>}
    </>}
  </div>
}

const STREAM_ZOOMS = [['fill', 'Крупно'], ['wide', 'Ширше'], ['full', 'Уся гра']] as const

/** Layout controls for a clip on the "My stream" template. */
function StreamClipControls({ clip, template, active }: { clip: Clip; template: StreamTemplate; active: boolean }): React.JSX.Element {
  const project = useStore(s => s.project)!
  const update = useStore(s => s.updateClip)
  const setLocal = useStore(s => s.updateClipLocal)
  const apply = (next: StreamTemplate, save = true): void => {
    const updated = applyStreamTemplate(clip, next, project.video)
    if (save) void update(updated)
    else setLocal(updated)
  }
  const applyToAll = (): void => {
    for (const other of project.clips) {
      if (other.id !== clip.id && clipStreamTemplate(other)) void update(applyStreamTemplate(other, template, project.video))
    }
  }
  if (!active) return <div className="mt-3 space-y-2">
    <p className="text-[11px] text-zinc-500">Зараз вибрано інше кадрування, тож шаблон «Мій стрім» не діє.</p>
    <button type="button" className="text-xs text-zinc-300 underline underline-offset-4" onClick={() => apply(template)}>
      Повернути шаблон «Мій стрім»
    </button>
  </div>
  return <div className="mt-3 space-y-2" data-testid="stream-clip-controls">
    <p className="text-[11px] text-zinc-500">
      Шаблон «Мій стрім»: {template.webcam ? 'вебка зверху, гра знизу' : 'лише гра'}.
    </p>
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Скільки гри показувати">
      {STREAM_ZOOMS.map(([value, label]) => <button key={value} type="button" aria-pressed={template.gameZoom === value}
        onClick={() => apply({ ...template, gameZoom: value })}
        className={`rounded-lg border px-2 py-2 text-xs transition ${template.gameZoom === value ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 text-zinc-400 hover:bg-surface-800'}`}>
        {label}
      </button>)}
    </div>
    {template.gameZoom !== 'full' && <label className="block text-[11px] text-zinc-500">
      Яку частину гри показувати: ліво ↔ право
      <input type="range" min={0} max={100} value={Math.round(template.gameFocusX * 100)} className="mt-1 w-full"
        onChange={e => apply({ ...template, gameFocusX: Number(e.target.value) / 100 }, false)}
        onMouseUp={e => apply({ ...template, gameFocusX: Number((e.target as HTMLInputElement).value) / 100 })} />
    </label>}
    {project.clips.length > 1 && <button type="button" className="text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-200" onClick={applyToAll}>
      Застосувати цей вигляд до всіх кліпів
    </button>}
  </div>
}

function RegionForm({ composition, onSave, open }: { composition: Composition; onSave: (composition: Composition) => void; open?: boolean }): React.JSX.Element {
  const [error, setError] = useState('')
  return <details open={open} className="text-xs text-zinc-400"><summary className="cursor-pointer py-1">Налаштувати області джерела для цього плану</summary>
    <form className="mt-2 space-y-3" onSubmit={event => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      const regions: Record<string, ContentRegion> = Object.fromEntries(composition.layers.map(layer => {
        const value = (field: string): number => Number(values.get(`${layer.role}-${field}`)) / 100
        return [layer.role, { x: value('x'), y: value('y'), width: value('width'), height: value('height') }]
      }))
      const updated = regions.presenter && presenterComposition(regions.content, regions.presenter, composition.preset)
      if (!updated) { setError('Keep both regions inside the source and avoid overlapping the presenter with the content.'); return }
      setError('')
      onSave(updated)
    }}>
      {composition.layers.map(layer => <fieldset key={layer.role}>
        <legend className="mb-1 capitalize">{layer.role} (% від джерела)</legend>
        <div className="grid grid-cols-4 gap-1">
          {(['x', 'y', 'width', 'height'] as const).map(field => <label key={field} className="text-[10px]">
            {field}<input name={`${layer.role}-${field}`} type="number" required min={0} max={100} step={.1}
              defaultValue={Number((layer.source[field] * 100).toFixed(1))}
              className="mt-1 w-full rounded border border-surface-600 bg-surface-850 p-1 text-xs text-zinc-200" />
          </label>)}
        </div>
      </fieldset>)}
      {error && <p role="alert" className="text-amber-300">{error}</p>}
      <button type="submit" className="rounded border border-surface-600 px-3 py-1.5 text-zinc-200">Застосувати області</button>
    </form>
  </details>
}
