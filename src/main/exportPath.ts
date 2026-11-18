import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Clip, Project } from '@shared/types'

export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control chars are invalid in Windows file names
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return (cleaned || 'clip').slice(0, 80)
}

/**
 * First non-colliding output path: "<base>.mp4", then "<base> (2).mp4", …
 * Two clips often share a title, and silently overwriting an earlier export
 * is never what the user wants.
 */
export function uniqueOutputPath(
  dir: string,
  baseName: string,
  exists: (p: string) => boolean = existsSync
): string {
  const first = join(dir, `${baseName}.mp4`)
  if (!exists(first)) return first
  for (let n = 2; ; n++) {
    const candidate = join(dir, `${baseName} (${n}).mp4`)
    if (!exists(candidate)) return candidate
  }
}

/** Recording date from an OBS-style file name ("2026-11-18 20-31-05.mkv"), else the project's. */
function recordingDate(project: Pick<Project, 'createdAt' | 'video'>): string {
  const fromName = /(\d{4}-\d{2}-\d{2})/.exec(project.video.fileName)?.[1]
  if (fromName) return fromName
  const d = new Date(project.createdAt || Date.now())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * File name (without extension) that sorts and reads well in a folder of
 * exports: "2026-11-18_The Last of Us_03_Джоел ледь не помер". The game
 * comes from the game-dialogue context when there is one; the number is the
 * clip's place in the project's list.
 */
export function exportBaseName(project: Pick<Project, 'createdAt' | 'video' | 'clips' | 'gameDialogue'>, clip: Pick<Clip, 'id' | 'title'>): string {
  const index = project.clips.findIndex((c) => c.id === clip.id)
  const number = String(index >= 0 ? index + 1 : 1).padStart(2, '0')
  const game = sanitizeFileName(project.gameDialogue?.context ?? '').replace(/^clip$/, '').slice(0, 30).trim()
  const title = sanitizeFileName(clip.title).slice(0, 50).trim()
  return [recordingDate(project), game, number, title].filter(Boolean).join('_')
}
