import { del, issueSignedToken, presignUrl, put } from '@vercel/blob'
import { HttpError } from './http'

// The store is private: nothing is reachable without a short-lived signed URL. It holds uploaded inputs
// until the worker has processed them, and the worker script. Results stay on the Spark.
export const BLOB_ACCESS: 'private' | 'public' = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private'
export const INPUT_TTL_DAYS = 7
export const WORKER_SCRIPT_PATH = 'system/worker.py'

export function blobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

function requireBlob() {
  if (!blobConfigured()) {
    throw new HttpError(503, 'Blob storage is not connected (BLOB_READ_WRITE_TOKEN missing). Connect a Blob store to the project and redeploy.')
  }
}

export async function signedGetUrl(pathname: string, ttlMs: number, fallbackUrl?: string) {
  requireBlob()
  if (BLOB_ACCESS === 'public' && fallbackUrl) return fallbackUrl
  const validUntil = Date.now() + ttlMs
  const tok = await issueSignedToken({ pathname, operations: ['get', 'head'], validUntil })
  const { presignedUrl } = await presignUrl(tok, { operation: 'get', pathname, validUntil, access: BLOB_ACCESS, useCache: false })
  return presignedUrl
}

export async function deleteBlobs(urlsOrPathnames: string[]) {
  const list = urlsOrPathnames.filter(Boolean)
  if (!list.length || !blobConfigured()) return
  try {
    await del(list)
  } catch (e) {
    console.error('blob delete failed', e)
  }
}

export async function blobPutSmall(pathname: string, body: string) {
  requireBlob()
  return put(pathname, body, { access: BLOB_ACCESS, addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' })
}
