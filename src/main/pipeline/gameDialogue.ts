import type { AudioRouting, GameDialogue, GameDialogueLine, PipelineProgress, Project } from '@shared/types'
import { isNoiseLine, speechCoverage, wordsToGameLines } from '@shared/gameDialogue'
import { languageName } from '@shared/outputLanguage'
import { AUDIO_CHUNK_SEC, extractAudioChunks } from './ffmpeg'
import { chatJSON, transcriptionChunkSec } from './openai'
import { transcribeChunks } from './transcribe'
import { speechFor } from './projectTranscript'
import { updateProject } from '../projects'
import { getAnalysisCredential, getModelPreferences } from '../settings'
import { timed } from './timing'

/**
 * Game-dialogue subtitles for multi-track recordings.
 *
 * The game's own track is transcribed separately (Whisper detects its
 * language — usually English or Russian), cleaned of the phrases Whisper
 * invents over music and effects, cut into subtitle-sized lines and
 * translated with the analysis model. The result is checkpointed on the
 * project, so regenerating clips never pays for it twice; changing only the
 * game context re-translates without transcribing again.
 */

export interface GameDialogueOptions {
  /** Credential for transcription (and translation, unless `translateKey` is given). */
  apiKey: string
  transcriptionModel: string
  /** Model and credential that translate; translation is skipped without a key. */
  analysisModel: string
  translateKey?: string | null
  audioTrack: number
  /** Game title or notes that keep names consistent. */
  context: string
  /** ISO-639-1 language to translate into. */
  targetLanguage: string
  span: { from: number; to: number }
}

const TRANSLATE_BATCH = 40
/** Earlier lines shown with each batch so pronouns and names carry over. */
const TRANSLATE_CONTEXT_LINES = 6

export async function ensureGameDialogue(
  project: Project,
  workDir: string,
  options: GameDialogueOptions,
  onProgress: (p: PipelineProgress) => void,
  signal?: AbortSignal
): Promise<GameDialogue | null> {
  const { from, to } = options.span
  const at = (fraction: number): number => from + (to - from) * fraction
  const existing = project.gameDialogue
  const sameSource = existing && existing.audioTrack === options.audioTrack

  let lines: GameDialogueLine[]
  if (sameSource) {
    if (existing.context === options.context.trim() && existing.targetLanguage === options.targetLanguage) {
      onProgress({ stage: 'transcribe', progress: at(1), message: 'Використовую збережені діалоги гри…' })
      return existing
    }
    lines = existing.lines
  } else {
    onProgress({ stage: 'audio', progress: at(0), message: 'Витягую звук гри…' })
    const speech = speechFor(project.video.path, signal, options.audioTrack)
    speech.catch(() => undefined)
    const chunks = await extractAudioChunks(
      project.video.path, workDir, project.video.durationSec,
      (f) => onProgress({ stage: 'audio', progress: at(f * 0.15), message: 'Витягую звук гри…' }),
      signal, transcriptionChunkSec(AUDIO_CHUNK_SEC), options.audioTrack
    )
    onProgress({ stage: 'transcribe', progress: at(0.15), message: 'Розпізнаю діалоги гри…' })
    // 'auto': games speak English, Russian and more, and a forced language
    // would make Whisper translate or garble the lines instead of transcribing.
    const transcript = await transcribeChunks(options.apiKey, options.transcriptionModel, chunks, 'auto',
      (f) => onProgress({ stage: 'transcribe', progress: at(0.15 + f * 0.55), message: 'Розпізнаю діалоги гри…' }), signal)
    const regions = (await speech) ?? undefined
    const words = transcript.segments.flatMap((s) => s.words)
    lines = wordsToGameLines(words)
      .filter((line) => !isNoiseLine(line.text, speechCoverage(line.start, line.end, regions)))
      .map((line, i) => ({
        id: `g${i}-${Math.round(line.start * 1000)}`,
        start: line.start,
        end: line.end,
        text: line.text,
        translation: line.text,
        ...(transcript.language && transcript.language !== 'auto' ? { language: transcript.language } : {})
      }))
  }

  const translateKey = options.translateKey === undefined ? options.apiKey : options.translateKey
  if (translateKey && lines.length) {
    lines = await translateLines(lines, { ...options, apiKey: translateKey }, (f) =>
      onProgress({ stage: 'transcribe', progress: at(0.7 + f * 0.3), message: 'Перекладаю діалоги гри…' }), signal)
  }

  const dialogue: GameDialogue = {
    audioTrack: options.audioTrack,
    targetLanguage: options.targetLanguage,
    context: options.context.trim(),
    lines
  }
  project.gameDialogue = dialogue
  await updateProject(project.id, (p) => {
    if (p.video.path === project.video.path && (p.sourceRevision ?? 0) === (project.sourceRevision ?? 0)) p.gameDialogue = dialogue
  })
  return dialogue
}

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'translation'],
        properties: {
          id: { type: 'string' },
          translation: { type: 'string', description: 'Subtitle text in the target language; empty when the line is not real speech' }
        }
      }
    }
  }
} as const

function systemPrompt(target: string, context: string): string {
  return [
    `You translate in-game dialogue from a video game stream into natural, colloquial ${target} subtitles.`,
    'Each input line is a short subtitle cut from speech recognition of the game audio. Lines may be fragments of one sentence: translate each so consecutive lines read naturally together, keeping each translation on its own line id.',
    'Keep character, place and item names consistent across the whole dialogue; keep established official names when the game has them. Preserve tone, humour, slang and swearing at the same strength. Keep it concise enough to read on screen.',
    `If a line is already in ${target}, return it cleaned up. If a line is clearly not dialogue (recognition noise, a stray sound, credits), return an empty translation for it.`,
    'Return every input id exactly once.',
    context ? `Context from the creator about the game: ${context}` : ''
  ].filter(Boolean).join('\n')
}

async function translateLines(
  lines: GameDialogueLine[],
  options: GameDialogueOptions & { apiKey: string },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<GameDialogueLine[]> {
  const target = languageName(options.targetLanguage) ?? 'Ukrainian'
  const out = lines.map((line) => ({ ...line }))
  for (let offset = 0; offset < out.length; offset += TRANSLATE_BATCH) {
    signal?.throwIfAborted()
    const batch = out.slice(offset, offset + TRANSLATE_BATCH)
    const before = out.slice(Math.max(0, offset - TRANSLATE_CONTEXT_LINES), offset)
    const user = [
      before.length ? `Earlier lines, for context only (already translated):\n${before.map((l) => `- ${l.text} => ${l.translation}`).join('\n')}` : '',
      `Lines to translate (JSON):\n${JSON.stringify(batch.map((l) => ({ id: l.id, text: l.text })))}`
    ].filter(Boolean).join('\n\n')
    try {
      const res = await chatJSON<{ lines?: Array<{ id: string; translation: string }> }>(
        options.apiKey, options.analysisModel,
        [{ role: 'system', content: systemPrompt(target, options.context.trim()) }, { role: 'user', content: user }],
        'game_dialogue_translation', TRANSLATION_SCHEMA as unknown as Record<string, unknown>, signal
      )
      const byId = new Map((res.lines ?? []).map((l) => [l.id, typeof l.translation === 'string' ? l.translation.trim() : null]))
      for (const line of batch) {
        const translated = byId.get(line.id)
        if (translated !== undefined && translated !== null) line.translation = translated
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // A failed batch keeps the original text so the subtitles still exist and
      // can be fixed by hand; the rest of the dialogue still gets translated.
      console.error('Game dialogue translation failed for a batch; keeping the original text:', error)
    }
    onProgress(Math.min(1, (offset + batch.length) / out.length))
  }
  // An empty translation means the model judged the line not to be dialogue.
  return out.filter((line) => line.translation.trim().length > 0)
}

/**
 * Save the chosen track roles and build (or clear) the game-dialogue
 * subtitles. Shared by clip finding and "caption whole video".
 */
export async function applyGameDialogue(
  project: Project,
  workDir: string,
  routing: AudioRouting | undefined,
  context: string,
  apiKey: string | null,
  span: { from: number; to: number },
  onProgress: (p: PipelineProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const settings = getModelPreferences()
  if (routing) {
    project.audioRouting = routing
    await updateProject(project.id, (p) => { p.audioRouting = routing })
  }
  if (!routing || routing.gameTrack === null) {
    if (routing && project.gameDialogue) {
      project.gameDialogue = null
      await updateProject(project.id, (p) => { p.gameDialogue = null })
    }
    return
  }
  const gameTrack = routing.gameTrack
  const target = settings.transcriptionLanguage && settings.transcriptionLanguage !== 'auto' ? settings.transcriptionLanguage : 'uk'
  await timed('game-dialogue', () => ensureGameDialogue(project, workDir, {
    apiKey: apiKey ?? '',
    transcriptionModel: settings.transcriptionModel,
    analysisModel: settings.analysisModel,
    translateKey: getAnalysisCredential() || null,
    audioTrack: gameTrack,
    context,
    targetLanguage: target,
    span
  }, onProgress, signal))
}
