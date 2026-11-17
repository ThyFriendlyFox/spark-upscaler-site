import { signedGetUrl } from '@/lib/blob'
import { HttpError, route } from '@/lib/http'
import { sparkFile, sparkMessage } from '@/lib/spark'
import { mustGetJob } from '@/lib/store'

type Ctx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
// Streaming from the Spark: the response size isn't capped, but the transfer must finish within 5 minutes.
export const maxDuration = 300

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']

// Downloads a result through this app, for when you aren't signed in to the Spark site in this browser.
// The page's main Download link goes straight to the Spark instead.
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const job = await mustGetJob(id)
  const out = job.output
  if (!out) throw new HttpError(404, 'This job has no result yet')

  // Results from before the move to the Spark live in Blob storage.
  if (!out.path && out.pathname) return Response.redirect(await signedGetUrl(out.pathname, 3600_000, out.url), 302)
  if (!out.path) throw new HttpError(404, 'This job has no result yet')

  const res = await sparkFile(out.path, req.headers.get('range'))
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let msg = text
    try {
      msg = sparkMessage(JSON.parse(text))
    } catch {}
    throw new HttpError(res.status === 404 ? 404 : 502, `The Spark couldn’t send the file (HTTP ${res.status}): ${msg.slice(0, 300)}`)
  }
  const headers = new Headers()
  for (const h of PASS) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  const name = out.path.split('/').pop() || 'video.mp4'
  headers.set('content-disposition', `attachment; filename="${name.replace(/"/g, '')}"`)
  headers.set('cache-control', 'private, no-store')
  return new Response(res.body, { status: res.status, headers })
})
