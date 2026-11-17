import { signedGetUrl } from '@/lib/blob'
import { HttpError, route } from '@/lib/http'
import { mustGetJob } from '@/lib/store'

type Ctx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

// Redirects to a short-lived signed URL for the private blob.
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params
  const which = new URL(req.url).searchParams.get('file') === 'input' ? 'input' : 'output'
  const job = await mustGetJob(id)
  const target = which === 'input' ? (job.input.deleted ? null : job.input) : job.output
  if (!target) throw new HttpError(404, `No ${which} file for this job`)
  const url = await signedGetUrl(target.pathname, 3600_000, target.url)
  return Response.redirect(url, 302)
})
