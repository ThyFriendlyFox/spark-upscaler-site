import { requireWorker } from '@/lib/auth'
import { signedGetUrl } from '@/lib/blob'
import { readJson, route } from '@/lib/http'
import { listJobs, saveJob, type Job } from '@/lib/store'

const STALE_MS = 5 * 60_000

function claimable(j: Job, workerId: string) {
  if (j.status === 'queued') return true
  if (j.status !== 'running' && j.status !== 'uploading') return false
  // Resume an interrupted job (e.g. the session ended mid-run) once its old worker has gone quiet.
  const last = j.progress?.updatedAt ?? j.updatedAt
  return !j.workerId || j.workerId === workerId || Date.now() - last > STALE_MS
}

export const POST = route(async (req) => {
  requireWorker(req)
  const { workerId } = await readJson<{ workerId?: string }>(req)
  const wid = String(workerId ?? 'unknown')
  const jobs = (await listJobs(200)).sort((a, b) => a.createdAt - b.createdAt)
  // Interrupted jobs first, so their chunk files on /workspace get reused.
  const job =
    jobs.find((j) => (j.status === 'running' || j.status === 'uploading') && claimable(j, wid)) ??
    jobs.find((j) => claimable(j, wid))
  if (!job) return Response.json({ job: null })
  job.status = 'running'
  job.workerId = wid
  job.attempts = (job.attempts ?? 0) + 1
  job.startedAt ??= Date.now()
  job.progress = { ...(job.progress ?? {}), phase: 'claimed', updatedAt: Date.now() }
  await saveJob(job)
  const inputUrl = await signedGetUrl(job.input.pathname, 12 * 3600_000, job.input.url)
  return Response.json({ job, inputUrl })
})
