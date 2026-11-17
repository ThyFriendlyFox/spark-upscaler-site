export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>

// Wraps a route handler so thrown HttpErrors (and unexpected errors) become JSON.
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx)
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status })
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      return Response.json({ error: msg }, { status: 500 })
    }
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'Expected a JSON body')
  }
}

export function originOf(req: Request) {
  const h = req.headers
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return host ? `${proto}://${host}` : new URL(req.url).origin
}
