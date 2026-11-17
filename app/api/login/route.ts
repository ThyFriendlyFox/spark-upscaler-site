import { cookies } from 'next/headers'
import { SESSION_COOKIE, checkPassword, createSession } from '@/lib/auth'
import { HttpError, readJson, route } from '@/lib/http'

export const POST = route(async (req) => {
  const { password } = await readJson<{ password?: string }>(req)
  // Small fixed delay blunts password guessing.
  await new Promise((r) => setTimeout(r, 400))
  if (!password || !checkPassword(password)) throw new HttpError(401, 'Wrong password')
  const s = await createSession()
  const jar = await cookies()
  jar.set(SESSION_COOKIE, s.value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: s.maxAge })
  return Response.json({ ok: true })
})

export const GET = route(async () => {
  return Response.json({ passwordSet: !!process.env.APP_PASSWORD })
})
