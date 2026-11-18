import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportProgress } from '@shared/types'

export type LocalWhisperModel = 'small' | 'large-v3'
export interface LocalWhisperInstallResult { pythonPath: string; modelPath: string }

let currentInstall: AbortController | null = null

export function localWhisperPaths(root: string, platform = process.platform): {
  environment: string; python: string; models: string
} {
  const environment = join(root, 'local-whisper', 'venv')
  return {
    environment,
    python: join(environment, platform === 'win32' ? 'Scripts' : 'bin', platform === 'win32' ? 'python.exe' : 'python'),
    models: join(root, 'local-whisper', 'models')
  }
}

function installScript(): string {
  return app.isPackaged ? join(process.resourcesPath, 'local-whisper', 'install.py')
    : join(app.getAppPath(), 'resources', 'local-whisper', 'install.py')
}

function run(command: string, args: string[], signal: AbortSignal, progress: (message: string) => void): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32' })
    let tail = ''
    let finished = false
    const stop = (): void => {
      if (!child.pid) { child.kill(); return }
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true })
        killer.on('error', () => child.kill())
      } else {
        try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() }
      }
    }
    const cleanup = (): void => {
      signal.removeEventListener('abort', stop)
      app.removeListener('before-quit', stop)
    }
    const done = (error?: Error): void => {
      if (finished) return
      finished = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    signal.addEventListener('abort', stop, { once: true })
    app.once('before-quit', stop)
    if (signal.aborted) stop()
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      const chunk = String(data)
      tail = (tail + chunk).slice(-3000)
      const line = chunk.trim().split('\n').at(-1)?.trim()
      if (line) progress(line.slice(0, 180))
    })
    child.on('error', error => done(new Error(`Could not run ${command}: ${error.message}`)))
    child.on('close', code => done(signal.aborted
      ? new Error('Встановлення Whisper скасовано. Повторіть, щоб продовжити завантаження.')
      : code === 0 ? undefined : new Error(`Не вдалося встановити Whisper (${code}). ${tail.trim()}`)))
  })
}

export function cancelLocalWhisperInstall(): void { currentInstall?.abort() }

export async function installLocalWhisper(
  model: LocalWhisperModel,
  requestedPython: string,
  onProgress: (progress: ImportProgress) => void
): Promise<LocalWhisperInstallResult> {
  if (model !== 'small' && model !== 'large-v3') throw new Error('Unsupported Whisper model.')
  if (currentInstall) throw new Error('Встановлення Whisper уже триває.')
  const controller = new AbortController()
  currentInstall = controller
  const paths = localWhisperPaths(app.getPath('userData'))
  const modelPath = join(paths.models, model)
  const announce = (progress: number, message: string): void => onProgress({ progress, message })
  try {
    await mkdir(paths.models, { recursive: true })
    if (!existsSync(paths.python)) {
      announce(0.05, 'Створюю окреме середовище Python…')
      const chosen = requestedPython.trim() || 'python'
      try {
        await run(chosen, ['-m', 'venv', paths.environment], controller.signal, message => announce(0.1, message))
      } catch (error) {
        if (chosen !== 'python' || process.platform === 'win32' || !(error instanceof Error) || !error.message.includes('Could not run')) throw error
        await run('python3', ['-m', 'venv', paths.environment], controller.signal, message => announce(0.1, message))
      }
    }
    announce(0.2, 'Встановлюю faster-whisper в окреме середовище…')
    // PyAV 15+ dropped the `metadata_errors` argument that faster-whisper's
    // decode_audio still passes, so every transcription fails with a TypeError.
    // Keep PyAV below 15 and wheels-only: pip then picks the newest 14.x that
    // ships a prebuilt wheel for this platform instead of compiling from source.
    await run(paths.python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'faster-whisper', 'huggingface-hub',
      'av>=11,<15', '--only-binary=av'],
    controller.signal, message => announce(0.3, message))
    // Apple Silicon also gets the MLX build, which transcribes on the GPU.
    // Optional: the CPU path still works if it cannot be installed.
    let gpu = false
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      announce(0.35, 'Встановлюю прискорення для Apple Silicon…')
      try {
        await run(paths.python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'mlx-whisper'],
          controller.signal, message => announce(0.4, message))
        gpu = true
      } catch (error) {
        controller.signal.throwIfAborted()
        console.warn('Apple Silicon Whisper acceleration unavailable; using the CPU:', error)
      }
    }
    announce(0.45, `Завантажую модель мови ${model}…`)
    const download = (withGpu: boolean): Promise<void> =>
      run(paths.python, ['-u', installScript(), model, modelPath, ...(withGpu ? ['--mlx'] : [])],
        controller.signal, message => announce(-1, message))
    try {
      await download(gpu)
    } catch (error) {
      // MLX weights are optional; a failed GPU download must not block the CPU model.
      controller.signal.throwIfAborted()
      if (!gpu) throw error
      console.warn('Apple Silicon Whisper model unavailable; using the CPU:', error)
      await download(false)
    }
    announce(0.95, 'Перевіряю локальне розпізнавання…')
    await run(paths.python, ['-c', 'import ctranslate2, faster_whisper; print("ready")'], controller.signal, () => {})
    announce(1, 'Локальний Whisper готовий.')
    return { pythonPath: paths.python, modelPath }
  } finally {
    currentInstall = null
  }
}
