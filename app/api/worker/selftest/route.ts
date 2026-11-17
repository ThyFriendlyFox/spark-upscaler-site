import { requireWorker } from '@/lib/auth'
import { blobHead, blobPutSmall, deleteBlobs, signedGetUrl, workerUploadToken } from '@/lib/blob'
import { HttpError, readJson, route } from '@/lib/http'

// Checks the storage round trip the worker depends on:
//  server   – server write → signed read → delete
//  token    – hands out an upload token so the worker can test its own uploader
//  verify   – confirms a worker-uploaded test file is readable, then deletes it
export const POST = route(async (req) => {
  requireWorker(req)
  const { action, pathname } = await readJson<{ action?: string; pathname?: string }>(req)
  const stamp = Date.now()

  if (action === 'server') {
    const p = `selftest/server-${stamp}.txt`
    const body = `spark-upscaler selftest ${stamp}`
    const put = await blobPutSmall(p, body)
    const url = await signedGetUrl(p, 300_000, put.url)
    const res = await fetch(url, { cache: 'no-store' })
    const text = await res.text()
    await deleteBlobs([put.url])
    return Response.json({ ok: res.ok && text === body, status: res.status, signedHost: new URL(url).host })
  }

  if (action === 'token') {
    const p = `selftest/worker-${stamp}.bin`
    return Response.json(await workerUploadToken(p, 512 * 1024 ** 2))
  }

  if (action === 'verify') {
    if (!pathname?.startsWith('selftest/')) throw new HttpError(400, 'Bad pathname')
    const h = await blobHead(pathname)
    const url = await signedGetUrl(pathname, 300_000, h.url)
    const res = await fetch(url, { cache: 'no-store' })
    const buf = new Uint8Array(await res.arrayBuffer())
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', buf)).toString('hex')
    await deleteBlobs([h.url])
    return Response.json({ ok: res.ok, size: buf.length, sha256: digest, headSize: h.size })
  }

  throw new HttpError(400, 'Unknown action')
})
