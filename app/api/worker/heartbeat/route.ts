import { requireWorker } from '@/lib/auth'
import { readJson, route } from '@/lib/http'
import { getJob, pushWorkerLog, setWorker } from '@/lib/store'

type Body = {
  workerId?: string
  version?: string
  state?: string
  message?: string
  jobId?: string | null
  env?: Record<string, unknown>
  log?: string[]
}

export const POST = route(async (req) => {
  requireWorker(req)
  const b = await readJson<Body>(req)
  await setWorker({
    workerId: String(b.workerId ?? 'unknown'),
    version: String(b.version ?? '?'),
    state: String(b.state ?? 'unknown'),
    message: b.message ? String(b.message).slice(0, 2000) : undefined,
    jobId: b.jobId ?? null,
    env: b.env,
    lastSeen: Date.now(),
  })
  if (Array.isArray(b.log)) await pushWorkerLog(b.log.map((l) => String(l).slice(0, 500)))
  let cancel = false
  if (b.jobId) cancel = (await getJob(b.jobId))?.status === 'canceled'
  return Response.json({ ok: true, cancel, serverTime: Date.now() })
})
