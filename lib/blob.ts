import { del, head, issueSignedToken, presignUrl, put } from '@vercel/blob'
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import { HttpError } from './http'

// The store is created private: nothing is reachable without a short-lived signed URL.
export const BLOB_ACCESS: 'private' | 'public' = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private'
export const INPUT_TTL_DAYS = 7
export const OUTPUT_TTL_DAYS = 14
export const BLOB_API_URL = 'https://vercel.com/api/blob'
export const BLOB_API_VERSION = '13'
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

export async function workerUploadToken(pathname: string, maxBytes: number) {
  requireBlob()
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes: ['video/mp4', 'application/octet-stream', 'text/plain'],
    maximumSizeInBytes: maxBytes,
    validUntil: Date.now() + 8 * 3600_000,
    addRandomSuffix: false,
    allowOverwrite: true,
    ttlDays: OUTPUT_TTL_DAYS,
  })
  return {
    token,
    pathname,
    apiUrl: BLOB_API_URL,
    apiVersion: BLOB_API_VERSION,
    partSize: 32 * 1024 * 1024,
    headers: {
      'x-vercel-blob-access': BLOB_ACCESS,
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-ttl-days': String(OUTPUT_TTL_DAYS),
    },
  }
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

export async function blobHead(pathname: string) {
  requireBlob()
  return head(pathname)
}

export async function blobPutSmall(pathname: string, body: string) {
  requireBlob()
  return put(pathname, body, { access: BLOB_ACCESS, addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' })
}
