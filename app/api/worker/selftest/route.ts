import { requireWorker } from '@/lib/auth'
import { blobPutSmall, deleteBlobs, signedGetUrl } from '@/lib/blob'
import { HttpError, readJson, route } from '@/lib/http'

// Lets the worker check, before taking jobs, that the app and its storage answer:
// a server write → signed read → delete round trip (inputs reach the worker the same way).
export const POST = route(async (req) => {
  requireWorker(req)
  const { action } = await readJson<{ action?: string }>(req)
  if (action !== 'server') throw new HttpError(400, 'Unknown action')
  const stamp = Date.now()
  const p = `selftest/server-${stamp}.txt`
  const body = `spark-upscaler selftest ${stamp}`
  const put = await blobPutSmall(p, body)
  const url = await signedGetUrl(p, 300_000, put.url)
  const res = await fetch(url, { cache: 'no-store' })
  const text = await res.text()
  await deleteBlobs([put.url])
  return Response.json({ ok: res.ok && text === body, status: res.status })
})
