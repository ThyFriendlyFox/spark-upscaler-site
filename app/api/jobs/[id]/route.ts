import { deleteBlobs } from '@/lib/blob'
import { HttpError, readJson, route } from '@/lib/http'
import { deleteJob, mustGetJob, removeStatsForJob, saveJob } from '@/lib/store'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  return Response.json({ job: await mustGetJob(id) })
})

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const { action } = await readJson<{ action?: string }>(req)
  const job = await mustGetJob(id)
  if (action === 'cancel') {
    if (job.status === 'done') throw new HttpError(400, 'Job already finished')
    job.status = 'canceled'
    job.finishedAt = Date.now()
  } else if (action === 'retry') {
    if (!['failed', 'canceled'].includes(job.status)) throw new HttpError(400, 'Only failed or canceled jobs can be retried')
    if (job.input.deleted) throw new HttpError(400, 'The input file was already deleted; upload it again')
    job.status = 'queued'
    job.error = undefined
    job.workerId = undefined
    job.finishedAt = undefined
  } else if (action === 'forget-stats') {
    const removed = await removeStatsForJob(id)
    return Response.json({ job, removed })
  } else {
    throw new HttpError(400, 'Unknown action')
  }
  await saveJob(job)
  return Response.json({ job })
})

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params
  const job = await mustGetJob(id)
  if (job.status === 'running' || job.status === 'uploading') {
    throw new HttpError(400, 'Cancel the job first; the worker is still using its files')
  }
  await deleteBlobs([job.input.deleted ? '' : job.input.url, job.output?.url ?? ''])
  await deleteJob(id)
  // Timing stats are kept on purpose: they are what the estimates learn from.
  return Response.json({ ok: true })
})
