export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatTimecode(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`
  if (bytes >= 1024 ** 2) {
    const mb = bytes / 1024 ** 2
    return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} МБ`
  }
  return `${(bytes / 1024).toFixed(0)} КБ`
}

export function scoreColor(score: number): string {
  if (score >= 85) return '#4ade80'
  if (score >= 70) return '#a3e635'
  if (score >= 55) return '#facc15'
  if (score >= 40) return '#fb923c'
  return '#f87171'
}

export function scoreLabel(score: number): string {
  if (score >= 85) return 'Exceptional'
  if (score >= 70) return 'Strong'
  if (score >= 55) return 'Good'
  if (score >= 40) return 'Fair'
  return 'Weak'
}

/**
 * Ukrainian plural form for a count: `one` for 1, 21, 31…; `few` for 2–4,
 * 22–24…; `many` for 0, 5–20, 25–30… (e.g. 1 кліп, 3 кліпи, 5 кліпів).
 */
export function pluralUk(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count))
  const lastTwo = n % 100
  const last = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}
