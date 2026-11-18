import type { Clip } from '@shared/types'
import { EDITORIAL_DIMENSIONS, type EditorialDimension, type EditorialRankingReport } from '@shared/editorialRanking'
import ScoreBadge from './ScoreBadge'
import { formatTimecode } from '../lib/format'

const STORY_LABELS: Record<string, string> = { complete: 'цілісна', incomplete: 'неповна', uncertain: 'невизначено' }
const FIDELITY_LABELS: Record<string, string> = { supported: 'підтверджена', misleading: 'вводить в оману', uncertain: 'невизначено' }

const DIMENSION_LABELS: Record<EditorialDimension, string> = {
  hook: 'Гачок', clarity: 'Зрозумілість', value: 'Цінність', payoff: 'Розв’язка', audienceFit: 'Під аудиторію'
}

export function EditorialScore({ clip, current, size = 'sm' }: {
  clip: Clip
  current: boolean
  size?: 'sm' | 'lg'
}): React.JSX.Element {
  if (!clip.editorial) return <ScoreBadge score={clip.viralityScore} size={size} />
  if (current && clip.editorial.status === 'reviewed' && clip.editorial.score !== null) {
    return <ScoreBadge score={clip.editorial.score} kind="editorial" size={size} />
  }
  return <span className="shrink-0 rounded-full border border-amber-400/25 bg-black/75 px-2.5 py-1 text-[11px] font-medium text-amber-200">
    {current ? 'Потребує перегляду' : 'Перегляньте зміни'}
  </span>
}

export function EditorialExplanation({ clip, current, compact = false }: {
  clip: Clip
  current: boolean
  compact?: boolean
}): React.JSX.Element {
  const assessment = clip.editorial
  if (!assessment) {
    return <p className={`${compact ? 'mt-2 line-clamp-2' : 'rounded-xl border border-surface-700 bg-surface-850 px-3.5 py-3'} text-xs leading-relaxed text-zinc-400`}>
      <span className="font-medium text-zinc-300">Попередня оцінка ШІ: </span>
      {clip.viralityReason || 'Згенеруйте заново, щоб оцінити цей фрагмент за поточними редакторськими критеріями.'}
      {!compact && clip.visualSummary && <span className="mt-2 block"><span className="font-medium text-zinc-300">Візуал джерела: </span>{clip.visualSummary}</span>}
      {!compact && <span className="mt-2 block text-zinc-500">Ця збережена оцінка не перевірялася за поточними редакторськими критеріями.</span>}
    </p>
  }
  if (compact) {
    return <div className="mt-2 text-xs leading-relaxed">
      {!current && <p className="text-amber-300">Фрагмент змінено. Перегляньте відредагований кліп.</p>}
      {current && assessment.status !== 'reviewed' && <p className="text-amber-300">Перевірте контекст і повноту розв’язки.</p>}
      <p className="line-clamp-2 text-zinc-400" title={assessment.reason}>{assessment.reason}</p>
      {assessment.deferredReason && <p className="mt-1 text-zinc-500" title={assessment.deferredReason}>Інший погляд на попередню ідею</p>}
    </div>
  }
  return <div className="rounded-xl border border-surface-700 bg-surface-850 px-3.5 py-3 text-xs leading-relaxed text-zinc-400">
    <p className="font-semibold text-zinc-200">Редакторська оцінка</p>
    <p className="mt-1">{assessment.reason}</p>
    {!current && <p className="mt-2 text-amber-300">Ваші зміни торкнулися оціненого фрагмента. Це пояснення стосується початкового варіанту; перегляньте відредагований кліп.</p>}
    {assessment.status !== 'reviewed' && <p className="mt-2 text-amber-300">Модель не змогла підтвердити цілісну й точну історію. Перед експортом перевірте контекст і розв’язку.</p>}
    {assessment.deferredReason && <p className="mt-2"><span className="font-medium text-zinc-300">Інший погляд: </span>{assessment.deferredReason}</p>}
    {assessment.concerns.length > 0 && <div className="mt-2 text-amber-200">
      <p className="font-medium">Перевірте перед експортом</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">{assessment.concerns.map((concern, index) => <li key={index}>{concern}</li>)}</ul>
    </div>}
    <details className="mt-3 border-t border-surface-700 pt-2">
      <summary className="cursor-pointer font-medium text-zinc-300">Деталі оцінки</summary>
      {assessment.takeaway && <p className="mt-2"><span className="font-medium text-zinc-300">Висновок: </span>{assessment.takeaway}</p>}
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {EDITORIAL_DIMENSIONS.map(dimension => <div key={dimension} className="contents">
          <dt>{DIMENSION_LABELS[dimension]}</dt>
          <dd className="tabular-nums text-zinc-300">{assessment.scores[dimension] === null ? 'Не оцінено' : `${assessment.scores[dimension]}/4`}</dd>
        </div>)}
      </dl>
      <p className="mt-2">Погляд моделі: історія — {STORY_LABELS[assessment.story] ?? assessment.story}; відповідність джерелу — {FIDELITY_LABELS[assessment.fidelity] ?? assessment.fidelity}.</p>
      {assessment.evidence.length > 0 && <div className="mt-2">
        <p className="font-medium text-zinc-300">Цитати з джерела</p>
        <ul className="mt-1 space-y-1">{assessment.evidence.slice(0, 3).map((item, index) => <li key={index}>
          <span className="font-medium text-zinc-300">{formatTimecode(item.time)} · {item.kind === 'speech' ? 'Мова' : 'Кадр'}: </span>{item.quote}
        </li>)}</ul>
      </div>}
      {clip.visualSummary && <p className="mt-2"><span className="font-medium text-zinc-300">Візуал джерела: </span>{clip.visualSummary}</p>}
      <p className="mt-2 text-zinc-500">Судження моделі за текстом і вибірковими кадрами. Оцінки — попередні редакторські. Перегляньте експорт, щоб перевірити субтитри, кадрування й таймінг; реакцію аудиторії не вимірювали.</p>
    </details>
  </div>
}

export function EditorialRankingSummary({ report, earlierAttempt = false }: { report?: EditorialRankingReport; earlierAttempt?: boolean }): React.JSX.Element | null {
  if (!report) return null
  return <details className="mt-4 rounded-xl border border-surface-700 bg-surface-900 px-4 py-3 text-xs leading-relaxed text-zinc-400">
    <summary className="cursor-pointer font-medium text-zinc-300">{earlierAttempt ? 'Остання спроба (попередні кліпи збережено) · ' : ''}Редакторська перевірка · оцінено: {report.reviewedCount} · потребують перегляду: {report.needsReviewCount}{report.rejectedCount > 0 ? ` · виключено: ${report.rejectedCount}` : ''}</summary>
    {earlierAttempt && <p className="mt-2 text-amber-300">Цей звіт — з останньої спроби аналізу. Збережені кліпи — з попереднього запуску.</p>}
    <p className="mt-2">Кандидатів: {report.candidateCount}. Виключено через проблеми з історією чи контекстом: {report.rejectedCount}; прибрано фрагментів, що перекриваються: {report.suppressedOverlapCount}. Повторів ідей, перенесених у кінець: {report.duplicateDeferredCount}.</p>
    <p className="mt-2">Запитів на аналіз (без повторних спроб провайдера): {report.reviewRequestCount + report.diversityRequestCount}. Оцінка стосується вибраних фрагментів; якість експорту й реакцію аудиторії ще треба перевірити.</p>
    {report.diversityStatus === 'failed' && <p className="mt-2 text-amber-300">Порівняння ідей було недоступне. Схожі ідеї можуть опинитися поруч.</p>}
    {report.limitations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}
  </details>
}
