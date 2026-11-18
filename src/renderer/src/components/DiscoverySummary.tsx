import type { SourceDiscoveryReport } from '@shared/sourceAnalysis'

/** Describes sampling coverage, never certifies continuous-video understanding. */
export default function DiscoverySummary({ report, earlierAttempt = false }: { report?: SourceDiscoveryReport; earlierAttempt?: boolean }): React.JSX.Element | null {
  if (!report) return null
  const frames = report.windows.filter(w => w.status === 'scanned').reduce((n, w) => n + w.sampleTimes.length, 0)
  const label = report.status === 'complete' ? 'Візуальне сканування завершено' : report.status === 'partial'
    ? 'Візуальне сканування неповне' : 'Візуальне сканування не вдалося'
  return <details className="mt-4 rounded-xl border border-surface-700 bg-surface-900 px-4 py-3 text-xs text-zinc-400">
    <summary className={report.status === 'complete' ? 'cursor-pointer text-zinc-300' : 'cursor-pointer text-amber-300'}>
      {earlierAttempt ? 'Остання спроба (попередні кліпи збережено) · ' : ''}
      {label} · візуальних пропозицій: {report.candidates.length}
      {report.cacheHit ? ' · використано збережене сканування' : ''}
    </summary>
    {earlierAttempt && <p className="mt-2 text-amber-300">Це сканування — з останньої спроби аналізу. Збережені кліпи — з попереднього запуску.</p>}
    <p className="mt-2 leading-relaxed">
      Проаналізовано кадрів: {frames}, ділянок відео: {report.successfulWindowCount}/{report.plannedWindowCount}.
      {' '}Найбільший проміжок між кадрами: {report.maximumSampleGapSec.toFixed(1)} с.
      {' '}Це вибірковий аналіз; короткі дії та рух між кадрами можуть бути пропущені.
    </p>
    <p className="mt-2 leading-relaxed">
      Успішних детальних переглядів подій: {report.successfulRefinementCount}/{report.refinementCount}.
      {' '}Запитів на аналіз у початковому скануванні: {report.analysisRequestCount}; повторні спроби провайдера можуть додати запити.
      {' '}Візуальні пропозиції все одно проходять перевірку довжини кліпу й редакторську перевірку.
    </p>
    {report.boundaryRejectedCandidateCount !== undefined && report.boundaryRejectedCandidateCount > 0 &&
      <p className="mt-2 leading-relaxed">Візуальних пропозицій, які не вмістилися у вибрану
        {' '}довжину без втрати дії та мови: {report.boundaryRejectedCandidateCount}. Спробуйте довшу довжину кліпу.</p>}
    {report.failedWindowCount > 0 && <p className="mt-2 text-amber-300">
      Ділянок відео, які не вдалося переглянути: {report.failedWindowCount}.
      {' '}Згенеруйте заново з увімкненим пошуком візуальних моментів, щоб повторити сканування.
    </p>}
    {report.limitations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">
      {report.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}
    </ul>}
  </details>
}
