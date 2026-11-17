import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from './lib/auth'

// Everything needs the login cookie except the login itself, the worker API
// (which checks its own bearer secret) and the worker script (plain code, no secrets).
const OPEN = ['/login', '/api/login', '/worker.py']

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  if (OPEN.includes(path) || path.startsWith('/api/worker/')) return NextResponse.next()
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
  if (path.startsWith('/api/')) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
}
