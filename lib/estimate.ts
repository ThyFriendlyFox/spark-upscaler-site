// Shared (client + server) model of how long an upscale takes.
//
// Cost model: every chunk is one run of the SeedVR2 CLI, so
//   chunk seconds ≈ a + b × work
// where work = frames × output megapixels ("megapixel-frames") and `a` is the
// fixed per-run cost (Python start, model load, VAE load). Each finished
// chunk the worker reports becomes one data point, so a single long clip
// already gives several points to fit `a` and `b`.

export type Settings = {
  model: string
  resolution: number
  maxResolution: number
  batchSize: number
  chunkFrames: number // 0 = auto
  seed: number
  colorCorrection: string
  attention: string
  compile: boolean
  vaeTiling: boolean
  prependFrames: number
  extraArgs: string
}

export type Meta = {
  width: number
  height: number
  duration: number
  fps: number
  frames: number
  fpsSource: 'container' | 'assumed' | 'probe'
}

export type ChunkStat = {
  ts: number
  jobId: string
  chunk: number
  frames: number
  inW: number
  inH: number
  outW: number
  outH: number
  model: string
  batchSize: number
  attention: string
  compile: boolean
  vaeTiling: boolean
  resolution: number
  seconds: number
}

export type JobStat = {
  ts: number
  jobId: string
  name: string
  model: string
  frames: number
  fps: number
  inW: number
  inH: number
  outW: number
  outH: number
  chunks: number
  chunkSeconds: number
  wallSeconds: number
  overheadSeconds: number
  estimateSeconds: number | null
  outputBytes: number | null
}

export type Fit = {
  a: number // seconds per chunk run
  b: number // seconds per megapixel-frame
  n: number // data points
  relErr: number // typical relative error of the fit on its own points
  method: 'ols' | 'ratio'
}

export type FitSet = {
  levels: Record<string, Fit>
  jobOverhead: number
  jobOverheadN: number
}

export type Estimate = {
  seconds: number
  low: number
  high: number
  chunks: number
  chunkFrames: number
  outW: number
  outH: number
  work: number
  a: number
  b: number
  basis: string
  n: number
}

export const MODELS: { id: string; label: string; prior: number; downloadGB: number }[] = [
  { id: 'seedvr2_ema_7b_sharp_fp16.safetensors', label: '7B Sharp · FP16', prior: 2.0, downloadGB: 16.5 },
  { id: 'seedvr2_ema_7b_fp16.safetensors', label: '7B · FP16', prior: 2.0, downloadGB: 16.5 },
  { id: 'seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors', label: '7B Sharp · FP8 mixed', prior: 2.0, downloadGB: 8.6 },
  { id: 'seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors', label: '7B · FP8 mixed', prior: 2.0, downloadGB: 8.6 },
  { id: 'seedvr2_ema_3b_fp16.safetensors', label: '3B · FP16', prior: 0.9, downloadGB: 6.8 },
  { id: 'seedvr2_ema_3b_fp8_e4m3fn.safetensors', label: '3B · FP8', prior: 0.9, downloadGB: 3.4 },
]

// Priors are rough guesses until real numbers arrive. The 7B figure scales the
// one public data point (8 s of 360p → 2K in ~8 min on an RTX 5090, about
// 0.7 s per megapixel-frame) by an assumed 3× for the GB10.
export const PRIOR_RUN_SECONDS = 45
export const PRIOR_JOB_OVERHEAD = 90
export const TARGET_CHUNK_SECONDS = 600

export const BATCH_SIZES = [5, 9, 13, 17, 21, 25, 33, 45, 61, 81]
export const RESOLUTIONS = [720, 1080, 1440, 2160]
export const COLOR_CORRECTIONS = ['lab', 'wavelet', 'wavelet_adaptive', 'hsv', 'adain', 'none']
export const ATTENTION_MODES = ['sdpa', 'flash_attn_2', 'sageattn_3']

export const DEFAULT_SETTINGS: Settings = {
  model: MODELS[0].id,
  resolution: 1080,
  maxResolution: 0,
  batchSize: 21,
  chunkFrames: 0,
  seed: 42,
  colorCorrection: 'lab',
  attention: 'sdpa',
  compile: false,
  vaeTiling: false,
  prependFrames: 0,
  extraArgs: '',
}

export function modelLabel(id: string) {
  return MODELS.find((m) => m.id === id)?.label ?? id.replace(/\.safetensors$/, '')
}

export function outputDims(w: number, h: number, resolution: number, maxResolution: number) {
  if (!w || !h) return { outW: 0, outH: 0 }
  const scale = resolution / Math.min(w, h)
  let ow = w * scale
  let oh = h * scale
  if (maxResolution > 0 && Math.max(ow, oh) > maxResolution) {
    const s = maxResolution / Math.max(ow, oh)
    ow *= s
    oh *= s
  }
  return { outW: Math.round(ow / 2) * 2, outH: Math.round(oh / 2) * 2 }
}

export function workUnits(frames: number, outW: number, outH: number) {
  return (frames * outW * outH) / 1e6
}

// Fit keys, from most to least specific. Estimates use the most specific
// level that has data, so a new setting borrows from the same model.
export function fitKeys(s: Pick<Settings, 'model' | 'attention' | 'compile' | 'vaeTiling' | 'batchSize'>) {
  const l3 = s.model
  const l2 = `${l3}|${s.attention}|${s.compile ? 'compile' : 'eager'}`
  const l1 = `${l2}|${s.vaeTiling ? 'tiled' : 'full'}|b${s.batchSize}`
  return [l1, l2, l3]
}

function fitPoints(pts: { x: number; y: number }[]): Fit | null {
  const n = pts.length
  if (n === 0) return null
  const sx = pts.reduce((s, p) => s + p.x, 0)
  const sy = pts.reduce((s, p) => s + p.y, 0)
  const mx = sx / n
  const my = sy / n
  let a = PRIOR_RUN_SECONDS
  let b = 0
  let method: Fit['method'] = 'ratio'
  if (n >= 4) {
    const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
    const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
    // Need enough spread in chunk sizes to separate the fixed cost from the slope.
    if (sxx > 0 && Math.sqrt(sxx / n) > 0.15 * mx) {
      const bb = sxy / sxx
      const aa = my - bb * mx
      if (bb > 0 && aa >= 0) {
        a = aa
        b = bb
        method = 'ols'
      }
    }
  }
  if (method === 'ratio') {
    a = Math.min(PRIOR_RUN_SECONDS, 0.5 * Math.min(...pts.map((p) => p.y)))
    b = Math.max(1e-6, pts.reduce((s, p) => s + Math.max(0, p.y - a), 0) / Math.max(1e-9, sx))
  }
  const rel = Math.sqrt(pts.reduce((s, p) => s + ((p.y - (a + b * p.x)) / Math.max(1, p.y)) ** 2, 0) / n)
  return { a, b, n, relErr: rel, method }
}

export function buildFits(chunks: ChunkStat[], jobs: JobStat[]): FitSet {
  const groups: Record<string, { x: number; y: number }[]> = {}
  for (const c of chunks) {
    if (!(c.seconds > 0) || !(c.frames > 0) || !(c.outW > 0)) continue
    const pt = { x: workUnits(c.frames, c.outW, c.outH), y: c.seconds }
    for (const k of fitKeys(c)) (groups[k] ??= []).push(pt)
  }
  const levels: Record<string, Fit> = {}
  for (const [k, pts] of Object.entries(groups)) {
    const f = fitPoints(pts)
    if (f) levels[k] = f
  }
  const overheads = jobs.map((j) => j.overheadSeconds).filter((v) => v >= 0 && v < 6 * 3600)
  overheads.sort((x, y) => x - y)
  const median = overheads.length ? overheads[Math.floor(overheads.length / 2)] : PRIOR_JOB_OVERHEAD
  return { levels, jobOverhead: median, jobOverheadN: overheads.length }
}

export function autoChunkFrames(frames: number, fps: number, batchSize: number, secondsPerFrame: number) {
  // Aim for ~10 minutes of compute per chunk: long enough that model loading
  // is a small share, short enough that a hard session cutoff loses little.
  const target = Math.max(batchSize, Math.floor(TARGET_CHUNK_SECONDS / Math.max(secondsPerFrame, 1e-6)))
  let cf = Math.max(batchSize, Math.round(target / batchSize) * batchSize)
  // Don't go below ~2 s of video per chunk.
  cf = Math.max(cf, Math.ceil((2 * (fps || 24)) / batchSize) * batchSize)
  if (frames > 0) cf = Math.min(cf, Math.ceil(frames / batchSize) * batchSize)
  return cf
}

export function planChunks(frames: number, chunkFrames: number) {
  const sizes: number[] = []
  if (frames <= 0 || chunkFrames <= 0) return sizes
  for (let s = 0; s < frames; s += chunkFrames) sizes.push(Math.min(chunkFrames, frames - s))
  return sizes
}

export function pickFit(settings: Settings, fits: FitSet | null) {
  const [l1, l2, l3] = fitKeys(settings)
  const labels = ['these exact settings', 'this model + attention', 'this model (other settings)']
  const keys = [l1, l2, l3]
  for (let i = 0; i < keys.length; i++) {
    const f = fits?.levels[keys[i]]
    if (f) return { fit: f, label: labels[i] }
  }
  return null
}

export function estimateJob(meta: Meta, settings: Settings, fits: FitSet | null): Estimate {
  const { outW, outH } = outputDims(meta.width, meta.height, settings.resolution, settings.maxResolution)
  const frames = Math.max(0, Math.round(meta.frames || meta.duration * (meta.fps || 24)))
  const picked = pickFit(settings, fits)
  const prior = MODELS.find((m) => m.id === settings.model)?.prior ?? 2.0
  const a = picked ? picked.fit.a : PRIOR_RUN_SECONDS
  const b = picked ? picked.fit.b : prior
  const mp = (outW * outH) / 1e6
  const chunkFrames =
    settings.chunkFrames > 0 ? settings.chunkFrames : autoChunkFrames(frames, meta.fps, settings.batchSize, b * mp)
  const sizes = planChunks(frames, chunkFrames)
  const work = workUnits(frames, outW, outH)
  const overhead = fits?.jobOverhead ?? PRIOR_JOB_OVERHEAD
  const seconds = sizes.length * a + b * work + overhead
  let rel: number
  let basis: string
  if (!picked) {
    rel = 0.6
    basis = 'prior guess (no runs with this model yet)'
  } else {
    rel = Math.min(0.6, Math.max(0.12, 2 * picked.fit.relErr)) + (picked.fit.n < 5 ? 0.15 : 0)
    basis = `${picked.fit.n} chunk${picked.fit.n === 1 ? '' : 's'} with ${picked.label}`
  }
  return {
    seconds,
    low: seconds / (1 + rel),
    high: seconds * (1 + rel),
    chunks: sizes.length,
    chunkFrames,
    outW,
    outH,
    work,
    a,
    b,
    basis,
    n: picked?.fit.n ?? 0,
  }
}

export function fmtDuration(sec: number | null | undefined) {
  if (sec == null || !isFinite(sec)) return '–'
  // Non-breaking spaces keep a number and its unit on one line.
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}\u00a0s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}\u00a0min`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h}\u00a0h ${mm}\u00a0min` : `${h}\u00a0h`
}

export function isValidBatch(n: number) {
  return Number.isInteger(n) && n >= 1 && (n - 1) % 4 === 0
}
