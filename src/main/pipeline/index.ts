import { throwIfSubscriptionError } from '../subscription'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AnalyzeOptions, BrowserCookieSource, ImportProgress, PipelineProgress, Project } from '@shared/types'
import { mapLimit } from './concurrency'
import { extractThumbnail, probeVideo } from './ffmpeg'
import { ensureTranscript } from './projectTranscript'
import { applyGameDialogue } from './gameDialogue'
import { dedupeClips, detectHighlights, GAME_STREAM_GUIDANCE, maxDurationFor, type HighlightHints } from './highlights'
import { discoverSourceMoments } from './sourceDiscovery'
import { visualCandidateClip } from './visualCandidates'
import { rankEditorialCandidates } from './editorialReview'
import { timed } from './timing'
import { assessClipVisuals, ensembleScore } from './visualScore'
import { completeVisualStory } from './visualStory'
import { attachBroll } from './broll'
import {
  assertCookieAuthSupported,
  cookieCopyErrorHint,
  cookieDpapiErrorHint,
  downloadUrlVideo,
  ensureYtDlp,
  fetchUrlMeta,
  isAuthError,
  isCookieCopyError,
  isDpapiDecryptError,
  withSelfUpdateRetry,
  YtDlpError,
  type CookieAuthOptions
} from './ytdlp'
import { getAnalysisCredential, getImportPreferences, getModelPreferences, missingCredentialName, saveStreamTemplate, getTranscriptionVocabulary, getCaptionLanguage, saveLastAnalyze } from '../settings'
import { ensureCaptionLanguage } from './captionLanguage'
import { trackLoudness } from './energy'
import { applyStreamTemplate } from '@shared/streamLayout'
import { DEFAULT_STREAM_TEMPLATE, normalizeStreamTemplate } from '@shared/composition'
import { projectDir, saveProject, updateProject } from '../projects'

export async function createProject(videoPath: string): Promise<Project> {
  const video = await probeVideo(videoPath)
  const now = Date.now()
  const project: Project = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: video.fileName.replace(/\.[^.]+$/, ''),
    video,
    transcript: null,
    clips: [],
    prompt: '',
    // This fork is for game streams: new videos start in that mode.
    videoType: 'gaming-stream'
  }
  await saveProject(project)
  return project
}

export async function createProjectFromUrl(
  url: string,
  onProgress: (p: ImportProgress) => void
): Promise<Project> {
  const binPath = await ensureYtDlp(onProgress)
  const prefs = getImportPreferences()
  const cookieOpts: CookieAuthOptions = {
    cookiesFromBrowser: prefs.importCookiesBrowser || undefined,
    cookiesFile: prefs.importCookiesPath
  }
  assertCookieAuthSupported(cookieOpts)
  onProgress({ progress: -1, message: 'Перевіряю відео…' })
  const meta = await withSelfUpdateRetry(binPath, onProgress, () =>
    fetchUrlMeta(binPath, url, cookieOpts)
  ).catch(rethrowWithLoginHint(prefs.importCookiesBrowser, Boolean(prefs.importCookiesPath)))

  const id = randomUUID()
  const dir = projectDir(id)
  await mkdir(dir, { recursive: true })
  const videoPath = join(dir, 'source.mp4')
  onProgress({ progress: 0.15, message: 'Завантажую відео…' })
  await withSelfUpdateRetry(binPath, onProgress, () =>
    downloadUrlVideo(binPath, meta.webpageUrl, videoPath, onProgress, cookieOpts)
  ).catch(rethrowWithLoginHint(prefs.importCookiesBrowser, Boolean(prefs.importCookiesPath)))

  onProgress({ progress: 0.97, message: 'Читаю відео…' })
  // Chapters in a downloaded VOD are the site's (game changes, sponsor
  // segments), not the creator's hotkey markers.
  const video = { ...await probeVideo(videoPath), markers: [] }
  const now = Date.now()
  const project: Project = {
    id,
    createdAt: now,
    updatedAt: now,
    name: meta.title,
    video,
    transcript: null,
    clips: [],
    prompt: '',
    // This fork is for game streams: new videos start in that mode.
    videoType: 'gaming-stream'
  }
  await saveProject(project)
  onProgress({ progress: 1, message: 'Готово' })
  return project
}

/**
 * When a site rejects the request for auth reasons (private/unlisted video,
 * enterprise Vimeo behind SSO), point at the browser-login option instead of
 * surfacing a bare extractor error.
 */
function rethrowWithLoginHint(
  browser: BrowserCookieSource,
  hasCookiesFile: boolean
): (err: unknown) => never {
  return (err: unknown): never => {
    if (err instanceof YtDlpError) {
      if (isDpapiDecryptError(err.message)) {
        throw new YtDlpError(cookieDpapiErrorHint(hasCookiesFile))
      }
      if (isCookieCopyError(err.message)) {
        throw new YtDlpError(cookieCopyErrorHint(browser, hasCookiesFile))
      }
      if (isAuthError(err.message)) {
        const hint = browser || hasCookiesFile
          ? `This video still refused the login. Make sure you are signed in to the site in ${browser || 'your browser'} (open the video there once), then retry. Or import a fresh cookies.txt file.`
          : 'This video seems to need a login (private, unlisted or behind company SSO). Sign in to the site in your browser, then set "Use browser login" on the import screen or import a cookies.txt file.'
        throw new YtDlpError(`${err.message} ${hint}`)
      }
    }
    throw err
  }
}

type ProgressFn = (p: PipelineProgress) => void


/**
 * The full "get clips" pipeline: audio extraction -> Whisper transcription ->
 * LLM highlight detection -> per-clip thumbnails. Mutates and saves the
 * project.
 *
 * Resilience: the transcript is checkpointed to disk as soon as Whisper
 * finishes, and reused on later runs — so retries after a failure, and
 * "regenerate with a different prompt", never pay for transcription again.
 * The whole pipeline is cancellable via the AbortSignal.
 */
export async function analyzeProject(
  project: Project,
  options: AnalyzeOptions,
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<Project> {
  const apiKey = getAnalysisCredential()
  if (!apiKey) {
    throw new Error(`Не налаштовано: ${missingCredentialName()}. Додайте його в Налаштуваннях перед генерацією кліпів.`)
  }
  const settings = getModelPreferences()
  const generationId = randomUUID()
  const workDir = join(tmpdir(), 'cutawan', `job-${project.id}`)
  await mkdir(workDir, { recursive: true })

  try {
    const routing = options.audioRouting
    const gameTrack = routing?.gameTrack ?? null
    // The next video's setup starts from these choices.
    saveLastAnalyze({
      videoType: options.videoType, clipLength: options.clipLength, hookFirst: options.hookFirst,
      visualDiscovery: options.visualDiscovery === true, editorialRanking: options.editorialRanking === true
    })
    if (options.retranscribe) project.transcript = null
    let transcript = await timed('transcript', () => ensureTranscript(
      project,
      workDir,
      {
        apiKey,
        model: settings.transcriptionModel,
        // Detected per chunk: forcing one language garbles speech in another,
        // and the caption-language step below decides what viewers read.
        language: 'auto',
        span: { from: 0.02, to: gameTrack === null ? 0.58 : 0.46 },
        noSpeechError: 'Мову не знайдено. Увімкніть «Шукати візуальні моменти», щоб шукати демонстрації та видимі події.',
        allowNoSpeech: options.visualDiscovery === true,
        audioTrack: routing?.voiceTrack ?? 0,
        vocabulary: getTranscriptionVocabulary()
      },
      onProgress,
      signal
    ))
    await ensureCaptionLanguage(project, getCaptionLanguage(),
      { apiKey: getAnalysisCredential() || null, model: settings.analysisModel }, onProgress, gameTrack === null ? 0.58 : 0.46, signal)
    if (project.transcript) transcript = project.transcript
    await applyGameDialogue(project, workDir, routing, options.gameContext ?? '', apiKey,
      { from: 0.46, to: 0.58 }, onProgress, signal)

    // The visual and editorial passes judge against the creator's focus; for
    // game streams that focus includes what makes a stream clip.
    const focusPrompt = options.videoType === 'gaming-stream'
      ? [options.prompt.trim(), GAME_STREAM_GUIDANCE].filter(Boolean).join('\n\n')
      : options.prompt
    const discovery = options.visualDiscovery ? await timed('source-discovery', () => discoverSourceMoments({
      videoPath: project.video.path, durationSec: project.video.durationSec, transcript,
      apiKey, model: settings.analysisModel, providerCacheKey: settings.analysisProviderKey,
      prompt: focusPrompt, maxClipDurationSec: maxDurationFor(options.clipLength),
      cacheDir: join(projectDir(project.id), 'discovery-cache'), signal,
      onProgress: message => onProgress({ stage: 'analyze', progress: .58, message })
    })) : undefined
    const visualClips = (discovery?.candidates ?? []).flatMap(candidate => {
      const clip = visualCandidateClip(candidate, transcript, project.video.durationSec, maxDurationFor(options.clipLength))
      return clip ? [clip] : []
    })
    if (discovery) {
      discovery.generationId = generationId
      discovery.admittedCandidateCount = visualClips.length
      discovery.boundaryRejectedCandidateCount = discovery.candidates.length - visualClips.length
    }
    // Save even an empty or incomplete scan: omissions must remain measurable.
    await updateProject(project.id, p => {
      if (p.video.path !== project.video.path || (p.sourceRevision ?? 0) !== (project.sourceRevision ?? 0)) {
        throw new Error('Відео змінилося під час аналізу. Згенеруйте кліпи заново для поточного відео.')
      }
      p.visualDiscovery = options.visualDiscovery === true
      p.discoveryReport = discovery
    })
    // Stream evidence: the creator's markers, how loud the game is, and what
    // the game and a friend in party chat said.
    if (gameTrack !== null) onProgress({ stage: 'analyze', progress: 0.59, message: 'Слухаю звук гри…' })
    const hints: HighlightHints = {
      markers: project.video.markers ?? [],
      gameLoudness: gameTrack !== null ? await timed('game-loudness', () => trackLoudness(project.video.path, gameTrack, signal)) : null,
      otherVoices: (project.gameDialogue?.lines ?? []).map((l) => ({ start: l.start, end: l.end, text: l.translation || l.text, speaker: l.speaker }))
    }
    onProgress({ stage: 'analyze', progress: 0.6, message: 'Шукаю моменти в мові…' })
    let clips = transcript.segments.length ? await timed('highlights', () => detectHighlights(
      apiKey,
      settings.analysisModel,
      transcript,
      options,
      project.video.durationSec,
      signal,
      hints
    )) : []
    for (const clip of clips) clip.discovery = { origin: 'transcript' }
    clips.push(...visualClips)
    if (clips.length === 0) {
      throw new Error(discovery?.status === 'failed'
        ? 'Візуальний пошук не вдався, а моментів у мові не знайдено. Перевірте з’єднання й повторіть.'
        : 'У вибраній довжині не знайдено завершених моментів. Спробуйте довшу довжину кліпу чи інші інструкції. Вибіркові кадри можуть пропустити короткі події.')
    }

    // Review the actual planned edit and repair explicitly missing visual payoffs.
    onProgress({ stage: 'analyze', progress: 0.64, message: 'Оцінюю візуал…' })
    let scored = 0
    const incomplete = new Set<string>()
    const incoherent = new Set<string>()
    await timed('visual-review', () => mapLimit(clips, 3, async (clip) => {
      signal?.throwIfAborted()
      let visual = await assessClipVisuals(
        apiKey,
        settings.analysisModel,
        project.video.path,
        transcript,
        clip,
        signal
      )
      if (visual?.needsVisualPayoff) {
        const repaired = await completeVisualStory(apiKey, settings.analysisModel, project.video.path,
          transcript, clip, project.video.durationSec, maxDurationFor(options.clipLength), signal)
        if (repaired) {
          Object.assign(clip, repaired)
          visual = await assessClipVisuals(apiKey, settings.analysisModel, project.video.path, transcript, clip, signal)
        }
        // A known incomplete demonstration needs a verified repair before recommendation.
        if (!repaired || !visual || visual.needsVisualPayoff) incomplete.add(clip.id)
      }
      if (visual) {
        if (visual.storyIssue) incoherent.add(clip.id)
        clip.viralityScore = ensembleScore(clip.viralityScore, visual.visualScore)
        clip.visualSummary = visual.visualSummary
        clip.visualLayout = visual.visualLayout
      }
      scored++
      onProgress({
        stage: 'analyze',
        progress: 0.64 + (scored / clips.length) * 0.13,
        message: 'Оцінюю візуал…'
      })
    }), { clips: clips.length })
    // The creator's own marked moments stay whatever the review thinks.
    clips = clips.filter(clip => clip.streamMarker !== undefined || !incomplete.has(clip.id))
    if (!clips.length) throw new Error('Кліпи обіцяли демонстрації, розв’язку яких не вдалося вмістити. Спробуйте довшу довжину кліпу.')
    clips = clips.filter(clip => clip.streamMarker !== undefined || !incoherent.has(clip.id))
    if (!clips.length) throw new Error('Кліпи не склалися в завершені самодостатні історії. Спробуйте довшу довжину кліпу чи інше відео.')
    clips.sort((a, b) => b.viralityScore - a.viralityScore)
    // Freeze the old policy on this exact surviving pool before the independent review.
    const baselineClips = dedupeClips(clips)
    if (options.editorialRanking === true) {
      const ranked = await timed('editorial-ranking', () => rankEditorialCandidates({
        video: project.video, sourceRevision: project.sourceRevision ?? 0, transcript,
        clips, baselineClips, apiKey, model: settings.analysisModel, providerCacheKey: settings.analysisProviderKey,
        prompt: focusPrompt, signal,
        onProgress: message => onProgress({ stage: 'analyze', progress: .8, message })
      }))
      ranked.report.generationId = generationId
      // Rejected/missing reviews remain in the report, including runs with no recommendation.
      await updateProject(project.id, p => {
        if (p.video.path !== project.video.path || (p.sourceRevision ?? 0) !== (project.sourceRevision ?? 0)) {
          throw new Error('Відео змінилося під час аналізу. Згенеруйте кліпи заново для поточного відео.')
        }
        p.rankingEnabled = true
        p.editorialRanking = ranked.report
      })
      // The review may reject a marked moment; the creator chose it, so it
      // stays (after the recommended clips).
      const kept = new Set(ranked.clips.map(clip => clip.id))
      clips = [...ranked.clips, ...baselineClips.filter(clip => clip.streamMarker !== undefined && !kept.has(clip.id))]
      if (!clips.length) throw new Error('Редакторська перевірка знайшла лише неповні чи оманливі фрагменти. Спробуйте довшу довжину кліпу чи інші інструкції; звіт перевірки збережено.')
    } else clips = baselineClips

    // Layouts for the top clips run in the background once the list is on
    // screen (see backgroundReframe.ts); every clip starts pending.
    for (const clip of clips) clip.reframeStatus = 'pending'
    // Gaming streams: every clip on the creator's template, no face tracking
    // or AI layout review needed. The template becomes the next default.
    if (options.videoType === 'gaming-stream') {
      const template = normalizeStreamTemplate(options.streamTemplate) ?? DEFAULT_STREAM_TEMPLATE
      clips = clips.map(clip => applyStreamTemplate({ ...clip, broll: [] }, template, project.video))
      saveStreamTemplate(template)
    }
    project.clips = clips
    project.prompt = options.prompt
    project.videoType = options.videoType
    await updateProject(project.id, (p) => {
      if (p.video.path !== project.video.path || (p.sourceRevision ?? 0) !== (project.sourceRevision ?? 0)) {
        throw new Error('Відео змінилося під час аналізу. Згенеруйте кліпи заново для поточного відео.')
      }
      p.clips = clips
      p.prompt = options.prompt
      p.videoType = options.videoType
      p.clipsGenerationId = generationId
      p.rankingEnabled = options.editorialRanking === true
      if (!p.rankingEnabled) delete p.editorialRanking
    })

    if (options.broll && options.videoType !== 'gaming-stream') {
      onProgress({ stage: 'broll', progress: 0.82, message: 'Шукаю зображення для вставок…' })
      let brolled = 0
      await timed('broll', () => mapLimit(clips, 3, async (clip) => {
        signal?.throwIfAborted()
        try {
          await attachBroll(apiKey, settings.analysisModel, transcript, project.id, clip, signal)
        } catch (err) {
          throwIfSubscriptionError(err)
          if (signal?.aborted) throw err
          console.error(`B-roll failed for clip ${clip.id}:`, err)
          clip.broll = []
        }
        brolled++
        onProgress({
          stage: 'broll',
          progress: 0.82 + (brolled / clips.length) * 0.08,
          message: 'Шукаю зображення для вставок…'
        })
      }))
      await updateProject(project.id, (p) => {
        if (p.video.path !== project.video.path || (p.sourceRevision ?? 0) !== (project.sourceRevision ?? 0)) return
        for (const current of p.clips) {
          const result = clips.find(c => c.id === current.id)
          if (result) current.broll = result.broll
        }
      })
    }

    onProgress({ stage: 'thumbnails', progress: 0.9, message: 'Створюю мініатюри…' })
    const thumbsDir = join(projectDir(project.id), 'thumbs')
    await mkdir(thumbsDir, { recursive: true })
    let thumbnailed = 0
    await timed('thumbnails', () => mapLimit(clips, 4, async (clip) => {
      signal?.throwIfAborted()
      const at = clip.suggestedStart + Math.min(1.5, (clip.suggestedEnd - clip.suggestedStart) / 2)
      try {
        clip.thumbnailPath = await extractThumbnail(project.video.path, at, join(thumbsDir, `${clip.id}.jpg`))
      } catch {
        clip.thumbnailPath = null
      }
      thumbnailed++
      onProgress({
        stage: 'thumbnails',
        progress: 0.9 + (thumbnailed / clips.length) * 0.08,
        message: 'Створюю мініатюри…'
      })
    }), { clips: clips.length })

    // Final save returns the freshest merged copy (clips from this run plus
    // anything — like a rename — that changed on disk while it ran).
    const persisted = await updateProject(project.id, (p) => {
      if (p.video.path !== project.video.path || (p.sourceRevision ?? 0) !== (project.sourceRevision ?? 0)) return
      p.clips = p.clips.map(current => {
        const result = clips.find(c => c.id === current.id)
        // Layouts were checkpointed individually. Never replay a stale pending
        // result over analysis that an editor/export completed in the meantime.
        return result ? { ...current, thumbnailPath: result.thumbnailPath } : current
      })
    })
    onProgress({ stage: 'done', progress: 1, message: 'Готово' })
    return persisted
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
