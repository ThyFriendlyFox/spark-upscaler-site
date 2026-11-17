import { redis } from './redis'
import { HttpError } from './http'
import { buildFits, type ChunkStat, type Estimate, type JobStat, type Meta, type Settings } from './estimate'

const P = 'su:'
const K = {
  job: (id: string) => `${P}job:${id}`,
  jobs: `${P}jobs`,
  chunkStats: `${P}stats:chunks`,
  jobStats: `${P}stats:jobs`,
  worker: `${P}worker`,
  workerLog: `${P}worker:log`,
  trash: `${P}trash`,
}

export type JobStatus = 'queued' | 'running' | 'uploading' | 'done' | 'failed' | 'canceled'

export type Job = {
  id: string
  createdAt: number
  updatedAt: number
  name: string
  size: number
  contentType: string
  input: { pathname: string; url: string; deleted?: boolean }
  // `path` (relative to /workspace on the Spark) for results kept on the Spark; pathname/url for old Blob results.
  output?: { path?: string; pathname?: string; url?: string; size: number }
  meta: Meta
  settings: Settings
  estimate: Estimate
  status: JobStatus
  workerId?: string
  attempts: number
  startedAt?: number
  finishedAt?: number
  progress?: {
    phase: string
    chunk?: number
    chunks?: number
    chunksDone?: number
    chunkElapsed?: number
    doneWork?: number
    doneSeconds?: number
    message?: string
    updatedAt: number
  }
  probe?: { frames: number; fps: number; width: number; height: number; duration: number; audio: boolean }
  error?: string
  logTail?: string[]
  timings?: Record<string, number>
  wallSeconds?: number
}

export type WorkerStatus = {
  workerId: string
  version: string
  state: string
  message?: string
  jobId?: string | null
  env?: Record<string, unknown>
  lastSeen: number
}

export function newId() {
  const t = Date.now().toString(36)
  const r = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('')
  return `${t}${r}`.slice(0, 16)
}

export async function getJob(id: string) {
  return (await redis().get<Job>(K.job(id))) ?? null
}

export async function mustGetJob(id: string) {
  const job = await getJob(id)
  if (!job) throw new HttpError(404, 'Job not found')
  return job
}

export async function saveJob(job: Job) {
  job.updatedAt = Date.now()
  const r = redis()
  await r.set(K.job(job.id), job)
  await r.zadd(K.jobs, { score: job.createdAt, member: job.id })
  return job
}

export async function updateJob(id: string, fn: (j: Job) => void | Job) {
  const job = await mustGetJob(id)
  const out = fn(job) ?? job
  return saveJob(out)
}

export async function deleteJob(id: string) {
  const r = redis()
  await r.del(K.job(id))
  await r.zrem(K.jobs, id)
}

export async function listJobs(limit = 100) {
  const r = redis()
  const ids = await r.zrange<string[]>(K.jobs, 0, limit - 1, { rev: true })
  if (!ids.length) return []
  const jobs = await r.mget<(Job | null)[]>(...ids.map(K.job))
  return jobs.filter((j): j is Job => !!j)
}

export async function addChunkStat(stat: ChunkStat) {
  await redis().rpush(K.chunkStats, stat)
}

export async function addJobStat(stat: JobStat) {
  await redis().rpush(K.jobStats, stat)
}

export async function getStats() {
  const r = redis()
  const [chunks, jobs] = await Promise.all([
    r.lrange<ChunkStat>(K.chunkStats, -5000, -1),
    r.lrange<JobStat>(K.jobStats, -2000, -1),
  ])
  return { chunks, jobs, fits: buildFits(chunks, jobs) }
}

export async function removeStatsForJob(jobId: string) {
  // Lets you drop a bad run (e.g. one that was disturbed) from the estimates.
  const r = redis()
  const [chunks, jobs] = await Promise.all([
    r.lrange<ChunkStat>(K.chunkStats, 0, -1),
    r.lrange<JobStat>(K.jobStats, 0, -1),
  ])
  const keepC = chunks.filter((c) => c.jobId !== jobId)
  const keepJ = jobs.filter((j) => j.jobId !== jobId)
  const removed = chunks.length - keepC.length + (jobs.length - keepJ.length)
  if (!removed) return 0
  const tx = r.multi()
  tx.del(K.chunkStats)
  tx.del(K.jobStats)
  if (keepC.length) tx.rpush(K.chunkStats, ...keepC)
  if (keepJ.length) tx.rpush(K.jobStats, ...keepJ)
  await tx.exec()
  return removed
}

export async function getWorker() {
  return (await redis().get<WorkerStatus>(K.worker)) ?? null
}

export async function setWorker(w: WorkerStatus) {
  await redis().set(K.worker, w)
}

export async function pushWorkerLog(lines: string[]) {
  if (!lines.length) return
  const r = redis()
  await r.rpush(K.workerLog, ...lines.slice(-200))
  await r.ltrim(K.workerLog, -300, -1)
}

// Finished videos to remove from the Spark. The Spark's file API is read-only, so the worker deletes them.
export async function addTrash(paths: string[]) {
  if (paths.length) await redis().sadd(K.trash, paths[0], ...paths.slice(1))
}

export async function getTrash(limit = 50) {
  return (await redis().smembers(K.trash)).slice(0, limit)
}

export async function removeTrash(paths: string[]) {
  if (paths.length) await redis().srem(K.trash, ...paths)
}

export async function getWorkerLog() {
  return redis().lrange<string>(K.workerLog, -300, -1)
}
