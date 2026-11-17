import { blobConfigured } from '@/lib/blob'
import { estimateJob } from '@/lib/estimate'
import { HttpError, readJson, route } from '@/lib/http'
import { redisConfigured } from '@/lib/redis'
import { sparkConfigured, sparkSiteUrl } from '@/lib/spark'
import { getStats, getWorker, listJobs, newId, saveJob, type Job } from '@/lib/store'
import { cleanMeta, cleanSettings } from '@/lib/validate'

export const dynamic = 'force-dynamic'

function setup() {
  return {
    appPassword: !!process.env.APP_PASSWORD,
    sparkLabToken: sparkConfigured(),
    workerSecret: !!process.env.WORKER_SECRET,
    blob: blobConfigured(),
    redis: !!redisConfigured(),
  }
}

export const GET = route(async () => {
  const s = setup()
  if (!s.redis) return Response.json({ setup: s, jobs: [], worker: null, sparkUrl: sparkSiteUrl() })
  const [jobs, worker] = await Promise.all([listJobs(), getWorker()])
  return Response.json({ setup: s, jobs, worker, sparkUrl: sparkSiteUrl(), now: Date.now() })
})

type CreateBody = {
  input?: { pathname?: string; url?: string }
  name?: string
  size?: number
  contentType?: string
  meta?: Parameters<typeof cleanMeta>[0]
  settings?: Parameters<typeof cleanSettings>[0]
}

export const POST = route(async (req) => {
  const body = await readJson<CreateBody>(req)
  const pathname = body.input?.pathname
  const url = body.input?.url
  if (!pathname || !url || !pathname.startsWith('inputs/')) throw new HttpError(400, 'Missing uploaded input')
  const meta = cleanMeta(body.meta)
  const settings = cleanSettings(body.settings)
  const { fits } = await getStats()
  const estimate = estimateJob(meta, settings, fits)
  // Freeze the chunk size at creation so a resumed job keeps the same plan.
  settings.chunkFrames = estimate.chunkFrames
  const now = Date.now()
  const job: Job = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: String(body.name ?? pathname.split('/').pop() ?? 'video').slice(0, 200),
    size: Number(body.size) || 0,
    contentType: String(body.contentType ?? 'video/mp4'),
    input: { pathname, url },
    meta,
    settings,
    estimate,
    status: 'queued',
    attempts: 0,
  }
  await saveJob(job)
  return Response.json({ job })
})
