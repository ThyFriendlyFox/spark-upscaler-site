import { HttpError } from './http'

// Uses Web Crypto only, so it runs in proxy.ts and in route handlers alike.

export const SESSION_COOKIE = 'su_session'
const enc = new TextEncoder()

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}

export function safeEqual(a: string, b: string) {
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  const n = Math.max(ab.length, bb.length)
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

function authSecret() {
  // AUTH_SECRET is optional; without it, changing APP_PASSWORD signs everyone out.
  const pw = process.env.APP_PASSWORD
  if (process.env.AUTH_SECRET) return `${process.env.AUTH_SECRET}:${pw ?? ''}`
  return pw ? `pw:${pw}` : null
}

export async function createSession(days = 30) {
  const secret = authSecret()
  if (!secret) throw new HttpError(503, 'APP_PASSWORD is not set')
  const exp = Date.now() + days * 86400_000
  return { value: `${exp}.${await hmacHex(secret, `session:${exp}`)}`, maxAge: days * 86400 }
}

export async function verifySession(value: string | undefined | null) {
  const secret = authSecret()
  if (!secret || !value) return false
  const [expStr, sig] = value.split('.')
  const exp = Number(expStr)
  if (!exp || exp < Date.now() || !sig) return false
  return safeEqual(sig, await hmacHex(secret, `session:${exp}`))
}

export function checkPassword(given: string) {
  const pw = process.env.APP_PASSWORD
  if (!pw) throw new HttpError(503, 'APP_PASSWORD is not set on the server')
  return safeEqual(given, pw)
}

export function workerSecret() {
  return process.env.WORKER_SECRET || null
}

export function requireWorker(req: Request) {
  const secret = workerSecret()
  if (!secret) throw new HttpError(503, 'WORKER_SECRET is not set on the server')
  const h = req.headers.get('authorization') ?? ''
  const given = h.replace(/^Bearer\s+/i, '')
  if (!given || !safeEqual(given, secret)) throw new HttpError(401, 'Bad worker secret')
}
