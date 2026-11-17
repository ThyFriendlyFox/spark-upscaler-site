// Booking rules, ported from the Spark site's own booking page (static/account.js) so this app only offers
// what the Spark will accept: whole one-hour slots inside the training window (19:00–07:00 Eastern by
// default), after the minimum notice, within the session length and weekly caps. The server checks again.

export type LabWindow = { start: string; end: string; tz: string; label: string }
export type LabRules = { window: LabWindow; min_notice_minutes?: number; max_session_hours?: number; idle_minutes?: number }
export type LabBooking = { id: number; start: number; end: number; status: string; mine?: boolean; who?: string; note?: string }
export type LabWeek = { week_start: number; my_cap: number; mine: number; all_cap: number; all: number }
export type LabSession = { booking_id: number; until: number; starting?: boolean } | null
export type LabData = {
  enabled?: boolean
  access?: { status?: string }
  rules?: LabRules
  bookings?: LabBooking[]
  weeks?: LabWeek[]
  session?: LabSession
}

export const DEFAULT_RULES: Required<Pick<LabRules, 'window' | 'max_session_hours' | 'min_notice_minutes'>> = {
  window: { start: '19:00', end: '07:00', tz: 'America/New_York', label: 'Eastern' },
  max_session_hours: 12,
  min_notice_minutes: 60,
}

export function rulesOf(L: LabData | null | undefined) {
  const r = L?.rules
  return {
    window: r?.window ?? DEFAULT_RULES.window,
    maxSessionHours: r?.max_session_hours ?? DEFAULT_RULES.max_session_hours,
    minNoticeMinutes: r?.min_notice_minutes ?? DEFAULT_RULES.min_notice_minutes,
    idleMinutes: r?.idle_minutes,
  }
}

// Wall-clock time in a timezone → unix seconds.
function zoned(y: number, mo: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const parts = (t: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(t))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>
  let t = guess
  for (let i = 0; i < 2; i++) {
    const p = parts(t)
    t = guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t)
  }
  return Math.round(t / 1000)
}

function tzDate(ts: number, tz: string): [number, number, number] {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ts * 1000))
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>
  return [p.year, p.month, p.day]
}

// The training window that is open now or opens next: {open, close} in unix seconds.
export function nextWindow(w: LabWindow, from: number) {
  const [sh, sm] = w.start.split(':').map(Number)
  const [eh, em] = w.end.split(':').map(Number)
  for (let back = -1; back < 3; back++) {
    const [y, mo, d] = tzDate(from + back * 86400, w.tz)
    const open = zoned(y, mo, d, sh, sm, w.tz)
    const [y2, mo2, d2] = tzDate(open + 86400, w.tz)
    const close = zoned(y2, mo2, d2, eh, em, w.tz)
    if (close > from) return { open, close }
  }
  return null
}

export type Slot = { start: number; end: number; booking: LabBooking | null; soon: boolean }
export type Night = { open: number; close: number; slots: Slot[]; free: number }

export function bookNights(L: LabData | null | undefined, nowSec = Date.now() / 1000, count = 8): Night[] {
  const { window: w, minNoticeMinutes } = rulesOf(L)
  const bookings = L?.bookings ?? []
  const notice = minNoticeMinutes * 60
  const earliest = nowSec + notice - (notice ? 0 : 300)
  const nights: Night[] = []
  let win = nextWindow(w, nowSec)
  let guard = 0
  while (win && nights.length < count && guard++ < 30) {
    const slots: Slot[] = []
    for (let t = win.open; t + 3600 <= win.close; t += 3600) {
      const b = bookings.find((x) => x.start < t + 3600 && x.end > t && x.status !== 'cancelled' && x.status !== 'denied')
      slots.push({ start: t, end: t + 3600, booking: b ?? null, soon: t < earliest })
    }
    const free = slots.filter((s) => !s.booking && !s.soon).length
    if (free || slots.some((s) => s.booking)) nights.push({ ...win, slots, free })
    win = nextWindow(w, win.close + 60)
  }
  return nights
}

export function weekLeft(L: LabData | null | undefined, ts: number) {
  const wk = L?.weeks?.find((x) => ts >= x.week_start && ts < x.week_start + 7 * 86400)
  return wk ? { mine: Math.max(0, wk.my_cap - wk.mine), all: Math.max(0, wk.all_cap - wk.all), cap: wk.my_cap, used: wk.mine } : null
}

// The problem with a pick, in words, or '' if it can be booked.
export function pickProblem(L: LabData | null | undefined, start: number, hours: number) {
  const { maxSessionHours } = rulesOf(L)
  const left = weekLeft(L, start)
  if (hours > maxSessionHours) return `Sessions are up to ${maxSessionHours} h.`
  if (left && hours > left.mine) return `You have ${left.mine} h left that week. A Chief can grant more.`
  if (left && hours > left.all) return `Only ${left.all} h of training is left for everyone that week.`
  return ''
}

// The Spark writes times in messages as [[t:unix:style]] so they read in the reader's own timezone.
export function sparkText(m: string) {
  return String(m).replace(/\[\[t:(\d+):(\w)\]\]/g, (_, ts) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(Number(ts) * 1000)),
  )
}
