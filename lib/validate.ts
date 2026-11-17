import { HttpError } from './http'
import {
  ATTENTION_MODES,
  COLOR_CORRECTIONS,
  DEFAULT_SETTINGS,
  MODELS,
  isValidBatch,
  type Meta,
  type Settings,
} from './estimate'

function int(v: unknown, def: number, min: number, max: number) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

export function cleanSettings(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  if (!MODELS.some((m) => m.id === s.model)) throw new HttpError(400, `Unknown model ${s.model}`)
  const batch = int(s.batchSize, DEFAULT_SETTINGS.batchSize, 1, 401)
  if (!isValidBatch(batch)) throw new HttpError(400, 'Batch size must be 4n+1 (5, 9, 13, 21, 33, …)')
  const extra = String(s.extraArgs ?? '').trim()
  if (extra && !extra.split(/\s+/).every((t) => /^(--[a-z0-9_]+|[A-Za-z0-9._:,=+-]+)$/.test(t))) {
    throw new HttpError(400, 'Extra args may only contain --flags and plain values')
  }
  return {
    model: s.model,
    resolution: int(s.resolution, 1080, 256, 4320),
    maxResolution: int(s.maxResolution, 0, 0, 8192),
    batchSize: batch,
    chunkFrames: int(s.chunkFrames, 0, 0, 100000),
    seed: int(s.seed, 42, 0, 2 ** 31 - 1),
    colorCorrection: COLOR_CORRECTIONS.includes(s.colorCorrection) ? s.colorCorrection : 'lab',
    attention: ATTENTION_MODES.includes(s.attention) ? s.attention : 'sdpa',
    compile: !!s.compile,
    vaeTiling: !!s.vaeTiling,
    prependFrames: int(s.prependFrames, 0, 0, 64),
    extraArgs: extra,
  }
}

export function cleanMeta(raw: Partial<Meta> | undefined): Meta {
  const m = raw ?? {}
  const fps = Number(m.fps) > 0 && Number(m.fps) < 1000 ? Number(m.fps) : 24
  const duration = Number(m.duration) > 0 ? Number(m.duration) : 0
  const frames = Number(m.frames) > 0 ? Math.round(Number(m.frames)) : Math.round(duration * fps)
  return {
    width: int(m.width, 0, 0, 16384),
    height: int(m.height, 0, 0, 16384),
    duration,
    fps,
    frames,
    fpsSource: m.fpsSource === 'container' || m.fpsSource === 'probe' ? m.fpsSource : 'assumed',
  }
}
