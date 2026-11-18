/**
 * Offline check of the "My stream" layout: builds a synthetic OBS scene
 * (gameplay with a webcam in the top-right corner and chapter markers),
 * checks the markers are read, and renders a clip on each game-zoom option
 * with captions and game subtitles. Frames go to .tmp/streamlayout-test.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-streamlayout.ts
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'
import { applyStreamTemplate } from '../src/shared/streamLayout'
import { visibleChatLines, visibleGameLines } from '../src/shared/gameDialogue'
import type { Clip, GameDialogue, StreamGameZoom, Transcript } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'streamlayout-test')

async function main(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })
  const meta = join(WORK, 'chapters.txt')
  await writeFile(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=12000\ntitle=Start\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=12000\nEND=20000\ntitle=Marker 1\n')
  const src = join(WORK, 'obs-scene.mp4')
  // Gameplay full frame; a "webcam" (bars + a moving ball) in the top-right corner.
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'smptebars=size=448x252:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
    '-i', meta,
    '-filter_complex', '[1:v]drawbox=x=0:y=0:w=iw:h=ih:color=white:t=6[cam];[0:v][cam]overlay=x=1440:y=24[v]',
    '-map', '[v]', '-map', '2:a', '-map_chapters', '3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '20', src
  ])
  const info = await probeVideo(src)
  assert.deepEqual(info.markers, [12], `markers read from chapters: ${JSON.stringify(info.markers)}`)
  console.log('✓ markers:', JSON.stringify(info.markers))

  const webcam = { x: 1440 / 1920, y: 24 / 1080, width: 448 / 1920, height: 252 / 1080 }
  const words = 'ну ти бачив що він зробив взагалі'.split(' ')
  const transcript: Transcript = {
    language: 'uk', durationSec: 20,
    segments: [{ id: 0, text: words.join(' '), start: 2, end: 2 + words.length * 0.5,
      words: words.map((t, i) => ({ text: t, start: 2 + i * 0.5, end: 2.45 + i * 0.5 })) }]
  }
  const dialogue: GameDialogue = {
    audioTrack: 2, targetLanguage: 'uk', context: 'Test Game',
    lines: [
      { id: 'g1', start: 2, end: 5, text: 'Get down!', translation: 'Лягай! Вони прямо за нами!' },
      { id: 'g2', start: 6.5, end: 8, text: 'Брат, дивись', translation: 'Брат, дивись', speaker: 'chat' }
    ]
  }
  const base = {
    id: 'c', suggestedStart: 1, suggestedEnd: 13, title: 'Тест', hook: 'Гачок', summary: '', viralityScore: 80,
    visualSummary: null, viralityReason: '', hashtags: [], thumbnailPath: null, focusTrack: null, broll: [],
    edit: { start: 1, end: 13, aspect: '9:16', reframeMode: 'fit-blur', framing: 'manual', tightenCuts: false, focusX: .5,
      captionsEnabled: true, captionStyleId: 'beast', showTitle: true, autoZoom: false }
  } as unknown as Clip
  for (const gameZoom of ['fill', 'wide', 'full'] as StreamGameZoom[]) {
    for (const cam of [true, false]) {
      const clip = applyStreamTemplate(base, { webcam: cam ? webcam : null, gameZoom, gameFocusX: .5 }, info)
      const name = `${gameZoom}${cam ? '' : '-nocam'}`
      const out = join(WORK, `render-${name}.mp4`)
      await renderClip({ clip, source: info, transcript, outputPath: out,
        gameLines: visibleGameLines(clip, dialogue), chatLines: visibleChatLines(clip, dialogue) })
      const rendered = await probeVideo(out)
      assert.equal(rendered.width, 1080)
      assert.equal(rendered.height, 1920)
      for (const t of [2.2, 6.2]) {
        await runFfmpeg(['-y', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=360:-1', join(WORK, `${name}-t${t}.png`)])
      }
      console.log(`✓ render ${name}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
