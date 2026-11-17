import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { INPUT_TTL_DAYS } from '@/lib/blob'
import { readJson, route } from '@/lib/http'

// Issues short-lived tokens so the browser uploads straight to Blob storage
// (function request bodies are capped at ~4.5 MB, videos are not).
// The proxy already requires the login cookie for this route.
export const POST = route(async (req) => {
  const body = await readJson<HandleUploadBody>(req)
  const json = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      if (!pathname.startsWith('inputs/')) throw new Error('Uploads must go under inputs/')
      return {
        allowedContentTypes: ['video/*', 'application/octet-stream'],
        maximumSizeInBytes: 8 * 1024 ** 3,
        addRandomSuffix: true,
        validUntil: Date.now() + 3 * 3600_000,
        ttlDays: INPUT_TTL_DAYS,
      }
    },
  })
  return Response.json(json)
})
