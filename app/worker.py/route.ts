import { get } from '@vercel/blob'
import { BLOB_ACCESS, WORKER_SCRIPT_PATH } from '@/lib/blob'

export const dynamic = 'force-dynamic'

// Serves the worker script from Blob storage, so it can be updated without a redeploy.
// It's plain code with no secrets, so it doesn't need the login.
export async function GET() {
  const r = await get(WORKER_SCRIPT_PATH, { access: BLOB_ACCESS, useCache: false }).catch(() => null)
  if (!r || r.statusCode !== 200) {
    return new Response('# worker script not uploaded yet\n', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
  return new Response(r.stream, {
    headers: { 'content-type': 'text/x-python; charset=utf-8', 'cache-control': 'no-store' },
  })
}
