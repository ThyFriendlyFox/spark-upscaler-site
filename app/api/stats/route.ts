import { route } from '@/lib/http'
import { getStats } from '@/lib/store'

export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  const { chunks, jobs, fits } = await getStats()
  return Response.json({ chunks: chunks.slice(-500), jobs: jobs.slice(-200), fits })
})
