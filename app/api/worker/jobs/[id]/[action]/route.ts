import { requireWorker } from '@/lib/auth'
import { deleteBlobs } from '@/lib/blob'
import { type ChunkStat, workUnits } from '@/lib/estimate'
import { HttpError, readJson, route } from '@/lib/http'
import { addChunkStat, addJobStat, mustGetJob, saveJob, type Job } from '@/lib/store'

type Ctx = { params: Promise<{ id: string; action: string }> }
type Body = Record<string, unknown>

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v: unknown, d = '') => (v == null ? d : String(v))

function assertOwner(job: Job, body: Body) {
  if (job.workerId && body.workerId && job.workerId !== body.workerId) {
    throw new HttpError(409, 'Another worker owns this job')
  }
}

export const POST = route<Ctx>(async (req, { params }) => {
  requireWorker(req)
  const { id, action } = await params
  const body = await readJson<Body>(req)
  const job = await mustGetJob(id)
  if (action !== 'fail') assertOwner(job, body)
  const cancel = job.status === 'canceled'
  const now = Date.now()

  switch (action) {
    case 'progress': {
      if (cancel) return Response.json({ ok: true, cancel })
      const p = job.progress ?? { phase: 'running', updatedAt: now }
      job.progress = {
        ...p,
        phase: str(body.phase, p.phase),
        chunk: body.chunk == null ? p.chunk : num(body.chunk),
        chunks: body.chunks == null ? p.chunks : num(body.chunks),
        chunkElapsed: body.chunkElapsed == null ? undefined : num(body.chunkElapsed),
        message: body.message == null ? p.message : str(body.message).slice(0, 500),
        updatedAt: now,
      }
      if (body.probe && typeof body.probe === 'object') job.probe = body.probe as Job['probe']
      if (Array.isArray(body.logTail)) job.logTail = (body.logTail as unknown[]).slice(-40).map((l) => str(l).slice(0, 400))
      if (body.status === 'uploading') job.status = 'uploading'
      await saveJob(job)
      return Response.json({ ok: true, cancel })
    }

    case 'chunk': {
      const s = (body.stat ?? {}) as Partial<ChunkStat>
      const stat: ChunkStat = {
        ts: now,
        jobId: id,
        chunk: num(s.chunk),
        frames: num(s.frames),
        inW: num(s.inW),
        inH: num(s.inH),
        outW: num(s.outW),
        outH: num(s.outH),
        model: job.settings.model,
        batchSize: job.settings.batchSize,
        attention: job.settings.attention,
        compile: job.settings.compile,
        vaeTiling: job.settings.vaeTiling,
        resolution: job.settings.resolution,
        seconds: num(s.seconds),
      }
      // Dry runs (ffmpeg resize instead of SeedVR2) must not teach the estimator.
      if (stat.seconds > 0 && stat.frames > 0 && !body.dryRun) await addChunkStat(stat)
      const p = job.progress ?? { phase: 'upscaling', updatedAt: now }
      job.progress = {
        ...p,
        phase: 'upscaling',
        chunksDone: num(body.chunksDone, (p.chunksDone ?? 0) + 1),
        chunks: body.chunks == null ? p.chunks : num(body.chunks),
        doneWork: (p.doneWork ?? 0) + workUnits(stat.frames, stat.outW, stat.outH),
        doneSeconds: (p.doneSeconds ?? 0) + stat.seconds,
        chunkElapsed: 0,
        updatedAt: now,
      }
      await saveJob(job)
      return Response.json({ ok: true, cancel })
    }

    case 'complete': {
      // The result stays on the Spark; `path` is relative to /workspace there.
      const out = (body.output ?? {}) as { path?: string; size?: number }
      if (!out.path || out.path.includes('..')) throw new HttpError(400, 'Missing output path')
      const timings = (body.timings ?? {}) as Record<string, number>
      const wall = num(timings.wall)
      const chunkSeconds = num(timings.chunks)
      job.output = { path: out.path, size: num(out.size) }
      job.status = 'done'
      job.finishedAt = now
      job.timings = timings
      job.wallSeconds = wall
      job.progress = { ...(job.progress ?? { updatedAt: now }), phase: 'done', updatedAt: now }
      const probe = job.probe
      const outW = num(body.outW)
      const outH = num(body.outH)
      if (body.dryRun) job.timings = { ...timings, dryRun: 1 }
      if (!body.dryRun) await addJobStat({
        ts: now,
        jobId: id,
        name: job.name,
        model: job.settings.model,
        frames: probe?.frames ?? job.meta.frames,
        fps: probe?.fps ?? job.meta.fps,
        inW: probe?.width ?? job.meta.width,
        inH: probe?.height ?? job.meta.height,
        outW,
        outH,
        chunks: num(body.chunks),
        chunkSeconds,
        wallSeconds: wall,
        // Only count this session's chunks: a resumed job's earlier chunks aren't in `wall`.
        overheadSeconds: Math.max(0, wall - num(timings.chunksThisRun, chunkSeconds)),
        estimateSeconds: job.estimate?.seconds ?? null,
        outputBytes: num(out.size) || null,
      })
      // The input upload isn't needed once the result exists.
      if (!job.input.deleted) {
        await deleteBlobs([job.input.url])
        job.input.deleted = true
      }
      await saveJob(job)
      return Response.json({ ok: true })
    }

    case 'fail': {
      if (job.status === 'canceled') return Response.json({ ok: true, cancel: true })
      job.status = 'failed'
      job.finishedAt = now
      job.error = str(body.error, 'Unknown error').slice(0, 4000)
      if (Array.isArray(body.logTail)) job.logTail = (body.logTail as unknown[]).slice(-60).map((l) => str(l).slice(0, 400))
      job.progress = { ...(job.progress ?? { updatedAt: now }), phase: 'failed', updatedAt: now }
      await saveJob(job)
      return Response.json({ ok: true })
    }
  }
  throw new HttpError(404, `Unknown action ${action}`)
})
