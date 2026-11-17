import { HttpError } from './http'

const SPARK_URL = process.env.SPARK_URL || 'https://spark.reagent-systems.com'
const LAB_URL = (process.env.SPARK_LAB_URL || 'https://spark-lab.reagent-systems.com/colab').replace(/\/$/, '')

// Forgive common paste mistakes: surrounding quotes, whitespace, a leading "Bearer ".
function normalizeToken(raw: string) {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .replace(/^bearer\s+/i, '')
    .trim()
}

function labToken() {
  const t = normalizeToken(process.env.SPARK_LAB_TOKEN ?? '')
  if (!t) throw new HttpError(503, 'SPARK_LAB_TOKEN is not set on the server')
  return t
}

// Says what kind of value SPARK_LAB_TOKEN holds, without revealing it.
export function labTokenHint() {
  const t = normalizeToken(process.env.SPARK_LAB_TOKEN ?? '')
  if (!t) return 'SPARK_LAB_TOKEN is empty.'
  if (t.startsWith('spark-lab-')) {
    return 'The Spark rejected this spark-lab- token (expired or replaced?). Make a new one on the Spark training page, update SPARK_LAB_TOKEN and redeploy.'
  }
  if (t.startsWith('sk-spark-')) {
    return 'SPARK_LAB_TOKEN holds your sk-spark-… chat API key. The lab needs the spark-lab-… token from the Spark training page. Replace the value and redeploy.'
  }
  return `SPARK_LAB_TOKEN doesn’t start with “spark-lab-” (it starts with “${t.slice(0, 4)}…”, ${t.length} characters). Paste only the spark-lab-… token from the Spark training page, then redeploy.`
}

export function sparkConfigured() {
  return !!process.env.SPARK_LAB_TOKEN
}

async function parse(res: Response) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// The Spark answers errors as {"error": {"message": "...", "code": "..."}}.
export function sparkMessage(data: unknown) {
  if (typeof data === 'string') return data.slice(0, 500)
  const d = data as { error?: { message?: string } | string; message?: string } | null
  const err = d?.error
  return (typeof err === 'string' ? err : err?.message) ?? d?.message ?? JSON.stringify(data).slice(0, 500)
}

export type SparkResult = { ok: boolean; status: number; data: unknown }

export async function sparkApi(path: string, init: { method?: string; body?: unknown } = {}): Promise<SparkResult> {
  const res = await fetch(`${SPARK_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${labToken()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // The Spark's own pages send this on every call; send it too.
      'X-Requested-With': 'spark',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
  return { ok: res.ok, status: res.status, data: await parse(res) }
}

// A file in /workspace on the Spark, as the Spark's file API serves it (any time, session or not).
export function sparkFileUrl(path: string) {
  return `${SPARK_URL}/api/lab/files/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

export function sparkSiteUrl() {
  return SPARK_URL
}

// Streams a file from the Spark with the lab token. Range requests pass through, so an interrupted
// download can resume where the Spark supports it.
export async function sparkFile(path: string, range: string | null) {
  return fetch(sparkFileUrl(path), {
    headers: { Authorization: `Bearer ${labToken()}`, ...(range ? { Range: range } : {}) },
    cache: 'no-store',
  })
}

export const labStatus = () => sparkApi('/api/lab')
export const bookSession = (start: number, hours: number, note: string) =>
  sparkApi('/api/lab/bookings', { method: 'POST', body: { start, hours, note } })
export const changeBookingTime = (id: number, hours: number) =>
  sparkApi(`/api/lab/bookings/${id}/time`, { method: 'POST', body: { hours } })
export const cancelBooking = (id: number) => sparkApi(`/api/lab/bookings/${id}/cancel`, { method: 'POST', body: {} })
export const endSession = () => sparkApi('/api/lab/end', { method: 'POST', body: {} })

// ---- Starting the worker inside a running session ----
// Same route as the Spark's spark_lab.py helper: open a Python kernel through the Jupyter Server API and run a
// few lines that fetch worker.py and start it fully detached with the kernel's own Python (the one with PyTorch).

function bootstrapCode(origin: string, secret: string) {
  // JSON string literals are valid Python string literals for this ASCII content.
  return [
    'import os, subprocess, sys, urllib.request',
    "d = '/workspace/upscaler'",
    'os.makedirs(d, exist_ok=True)',
    `urllib.request.urlretrieve(${JSON.stringify(`${origin}/worker.py`)}, d + '/worker.py')`,
    `env = dict(os.environ, SU_APP=${JSON.stringify(origin)}, SU_SECRET=${JSON.stringify(secret)})`,
    "log = open(d + '/worker.log', 'ab')",
    "p = subprocess.Popen([sys.executable, d + '/worker.py'], cwd=d, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)",
    "print('worker started, pid', p.pid, 'python', sys.executable)",
  ].join('\n')
}

export function workerStartCommand(origin: string, secret: string) {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  return [
    'mkdir -p /workspace/upscaler && cd /workspace/upscaler',
    `python3 -c "import urllib.request as u; u.urlretrieve('${origin}/worker.py', 'worker.py')"`,
    `(SU_APP=${q(origin)} SU_SECRET=${q(secret)} setsid nohup python3 worker.py >> worker.log 2>&1 &)`,
  ].join(' && ')
}

export async function startWorkerInSession(origin: string, secret: string) {
  const t = labToken()
  const created = await fetch(`${LAB_URL}/api/kernels`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'python3' }),
    cache: 'no-store',
  })
  if (!created.ok) {
    const msg = sparkMessage(await parse(created))
    throw new HttpError(
      created.status >= 400 && created.status < 500 ? 409 : 502,
      `Couldn’t open a Python kernel in your session (HTTP ${created.status}: ${msg}). Is a session running? It takes a minute or two after it starts.`,
    )
  }
  const { id } = (await created.json()) as { id: string }
  const msgId = crypto.randomUUID().replace(/-/g, '')
  const wsUrl = `${LAB_URL.replace(/^http/, 'ws')}/api/kernels/${encodeURIComponent(id)}/channels?token=${encodeURIComponent(t)}`

  const output = await new Promise<string>((resolve, reject) => {
    const out: string[] = []
    // Node's WebSocket (undici) accepts request headers as a non-standard second argument.
    const WS = WebSocket as unknown as new (url: string, opts?: unknown) => WebSocket
    const ws = new WS(wsUrl, { headers: { Authorization: `Bearer ${t}` } })
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {}
      reject(new HttpError(504, 'The lab kernel didn’t answer within 45 seconds.'))
    }, 45_000)
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          header: { msg_id: msgId, msg_type: 'execute_request', session: crypto.randomUUID().replace(/-/g, ''), username: '', version: '5.3' },
          parent_header: {},
          metadata: {},
          channel: 'shell',
          content: { code: bootstrapCode(origin, secret), silent: false, allow_stdin: false },
        }),
      )
    }
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data))
        if (m?.parent_header?.msg_id !== msgId) return
        const c = m.content ?? {}
        if (m.msg_type === 'stream') out.push(c.text)
        if (m.msg_type === 'error') out.push(String((c.traceback ?? []).join('\n')).replace(/\x1b\[[0-9;]*m/g, ''))
        if (m.msg_type === 'status' && c.execution_state === 'idle') {
          clearTimeout(timer)
          ws.close()
          resolve(out.join(''))
        }
      } catch {}
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new HttpError(502, 'Couldn’t connect to the lab kernel.'))
    }
  })
  if (!/worker started/.test(output)) throw new HttpError(502, `The worker didn’t start: ${output.slice(-800) || 'no output'}`)
  return { output: output.trim().slice(-1000) }
}
