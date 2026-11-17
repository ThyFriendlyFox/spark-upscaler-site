import { workerSecret } from '@/lib/auth'
import { sparkText } from '@/lib/booking'
import { HttpError, originOf, readJson, route } from '@/lib/http'
import {
  bookSession,
  cancelBooking,
  changeBookingTime,
  endSession,
  labStatus,
  labTokenHint,
  sparkMessage,
  startWorkerInSession,
  workerStartCommand,
  type SparkResult,
} from '@/lib/spark'
import { getWorkerLog } from '@/lib/store'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  const secret = workerSecret()
  const origin = originOf(req)
  const [raw, log] = await Promise.all([
    labStatus().catch((e: Error): SparkResult => ({ ok: false, status: 0, data: e.message })),
    getWorkerLog().catch(() => [] as string[]),
  ])
  // On an auth failure, explain what's wrong with the configured token.
  const lab = !raw.ok && raw.status === 401 ? { ...raw, data: `The Spark says “${sparkMessage(raw.data)}” ${labTokenHint()}` } : raw
  return Response.json({ lab, workerLog: log, startCommand: secret ? workerStartCommand(origin, secret) : null })
})

// Pass the Spark's own answer through: its status for client errors (so the page can show the reason),
// 502 only when the Spark itself failed.
function relay(r: SparkResult) {
  if (r.ok) return Response.json({ ok: true, data: r.data })
  const status = r.status >= 400 && r.status < 500 ? r.status : 502
  const reason = sparkText(sparkMessage(r.data))
  const hint = r.status === 401 ? ` ${labTokenHint()}` : ''
  return Response.json({ error: `The Spark said: ${reason}${hint}`, spark: r.data }, { status })
}

type Body = { action?: string; start?: number; hours?: number; note?: string; id?: number }

export const POST = route(async (req) => {
  const body = await readJson<Body>(req)
  switch (body.action) {
    case 'book': {
      const start = Number(body.start)
      const hours = Number(body.hours)
      const note = String(body.note ?? '').trim()
      if (!Number.isInteger(start) || start * 1000 < Date.now()) throw new HttpError(400, 'Pick a start hour from the list.')
      if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new HttpError(400, 'Pick whole hours.')
      if (!note) throw new HttpError(400, 'Add a short note saying what the session is for.')
      return relay(await bookSession(start, hours, note.slice(0, 500)))
    }
    case 'time': {
      const id = Number(body.id)
      const hours = Number(body.hours)
      if (!id || (hours !== 1 && hours !== -1)) throw new HttpError(400, 'Bad request')
      return relay(await changeBookingTime(id, hours))
    }
    case 'cancel': {
      const id = Number(body.id)
      if (!id) throw new HttpError(400, 'Bad request')
      return relay(await cancelBooking(id))
    }
    case 'end':
      return relay(await endSession())
    case 'start-worker': {
      const secret = workerSecret()
      if (!secret) throw new HttpError(503, 'WORKER_SECRET is not set')
      return Response.json(await startWorkerInSession(originOf(req), secret))
    }
  }
  throw new HttpError(400, 'Unknown action')
})
