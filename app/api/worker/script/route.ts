import { put } from '@vercel/blob'
import { requireWorker } from '@/lib/auth'
import { BLOB_ACCESS, WORKER_SCRIPT_PATH } from '@/lib/blob'
import { HttpError, route } from '@/lib/http'

// Replaces the worker script that /worker.py serves (worker secret required).
export const PUT = route(async (req) => {
  requireWorker(req)
  const text = await req.text()
  if (!text.startsWith('#!/usr/bin/env python3') || text.length > 1_000_000) {
    throw new HttpError(400, 'That does not look like the worker script')
  }
  const version = text.match(/^VERSION = "([^"]+)"/m)?.[1] ?? '?'
  await put(WORKER_SCRIPT_PATH, text, {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/x-python',
    cacheControlMaxAge: 60,
  })
  return Response.json({ ok: true, version, bytes: text.length })
})
