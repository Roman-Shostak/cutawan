/**
 * Offline integration check for game-dialogue subtitles: builds a synthetic
 * OBS-style recording with three audio tracks (mix, mic, game), checks the
 * tracks are probed, that the chosen track is the one extracted, and renders
 * a clip with translated game lines burned in (captions on and off, with
 * tightening). Frames are written to .tmp/gamedialogue-test for inspection.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-gamedialogue.ts
 */
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { extractAudioChunks, FFMPEG_PATH, probeVideo, runBinaryFull, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'
import { visibleGameLines } from '../src/shared/gameDialogue'
import type { Clip, GameDialogue, Transcript } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'gamedialogue-test')

async function meanVolume(path: string): Promise<number> {
  const { stderr } = await runBinaryFull(FFMPEG_PATH, ['-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'])
  const m = /mean_volume: (-?[\d.]+) dB/.exec(stderr)
  return m ? Number(m[1]) : -999
}

async function main(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })
  const src = join(WORK, 'obs-3track.mkv')
  // Track 1 mix (loud), track 2 mic (quiet tone), track 3 game (silent).
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=20,volume=0.2',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=20',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-t', '20',
    '-metadata:s:a:0', 'title=Track1', '-metadata:s:a:1', 'title=Mic', '-metadata:s:a:2', 'title=Game',
    src
  ])
  const info = await probeVideo(src)
  assert.equal(info.audioTracks?.length, 3, 'three audio tracks probed')
  console.log('✓ probe:', JSON.stringify(info.audioTracks))

  const loud = await extractAudioChunks(src, WORK, info.durationSec, () => {}, undefined, 600, 0)
  const mic = await extractAudioChunks(src, WORK, info.durationSec, () => {}, undefined, 600, 1)
  const game = await extractAudioChunks(src, WORK, info.durationSec, () => {}, undefined, 600, 2)
  const [v0, v1, v2] = [await meanVolume(loud[0].path), await meanVolume(mic[0].path), await meanVolume(game[0].path)]
  assert.ok(v0 > v1 && v1 > v2, `track volumes ordered: ${v0} > ${v1} > ${v2}`)
  assert.notEqual(loud[0].path, game[0].path, 'per-track chunk names')
  console.log(`✓ extract per track: mix ${v0} dB, mic ${v1} dB, game ${v2} dB`)

  const transcript: Transcript = {
    language: 'uk', durationSec: 20,
    segments: [{ id: 0, text: 'ну ти бачив це взагалі', start: 1, end: 4,
      words: 'ну ти бачив це взагалі'.split(' ').map((t, i) => ({ text: t, start: 1 + i * 0.6, end: 1.5 + i * 0.6 })) },
    { id: 1, text: 'я в шоці', start: 12, end: 14,
      words: 'я в шоці'.split(' ').map((t, i) => ({ text: t, start: 12 + i * 0.6, end: 12.5 + i * 0.6 })) }]
  }
  const dialogue: GameDialogue = {
    audioTrack: 2, targetLanguage: 'uk', context: '',
    lines: [
      { id: 'g1', start: 1.5, end: 4.5, text: 'Joel, get down! They are right behind us!', translation: 'Джоеле, лягай! Вони прямо за нами!' },
      { id: 'g2', start: 6, end: 8.5, text: 'Где патроны? У меня пусто.', translation: 'Де набої? У мене порожньо.' },
      { id: 'g3', start: 12, end: 14, text: 'Shh.', translation: 'Тихо.' }
    ]
  }
  const baseEdit = {
    start: 1, end: 15, aspect: '9:16', reframeMode: 'crop', framing: 'manual', tightenCuts: false, focusX: 0.5,
    captionsEnabled: true, captionStyleId: 'beast', showTitle: true, autoZoom: false
  }
  const makeClip = (edit: Record<string, unknown>): Clip => ({
    id: 'c', suggestedStart: 1, suggestedEnd: 15, title: 'Тест', hook: 'Гра заговорила', summary: '', viralityScore: 80,
    visualSummary: null, viralityReason: '', hashtags: [], thumbnailPath: null, focusTrack: null, broll: [],
    edit: { ...baseEdit, ...edit }
  } as unknown as Clip)

  const cases: Array<[string, Record<string, unknown>]> = [
    ['with-captions', {}],
    ['game-only', { captionsEnabled: false }],
    ['hidden-g2', { hiddenGameLines: ['g2'] }],
    ['game-off', { gameSubtitles: false }]
  ]
  for (const [name, edit] of cases) {
    const clip = makeClip(edit)
    const gameLines = visibleGameLines(clip, dialogue)
    const out = join(WORK, `render-${name}.mp4`)
    await renderClip({ clip, source: info, transcript, gameLines, outputPath: out })
    const rendered = await probeVideo(out)
    assert.equal(rendered.height, 1920)
    for (const t of [2, 6]) {
      await runFfmpeg(['-y', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=540:-1', join(WORK, `${name}-t${t}.png`)])
    }
    console.log(`✓ render ${name}: ${gameLines.length} game lines, ${rendered.durationSec.toFixed(1)}s`)
  }
  console.log('Frames in', WORK)
}

main().catch((e) => { console.error(e); process.exit(1) })
