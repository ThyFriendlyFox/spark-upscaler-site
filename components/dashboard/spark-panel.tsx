'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Copy, RefreshCw } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/brand'
import { Confirm } from '@/components/confirm'
import { Bar, Swap } from '@/components/motion'
import { PendingButton } from '@/components/pending-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { bookNights, pickProblem, rulesOf, weekLeft, type LabData } from '@/lib/booking'
import type { WorkerStatus } from '@/lib/store'
import { cn } from '@/lib/utils'
import { KV, LogBlock, Section, ago, api, type LabResp } from './shared'

const fmtHour = () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const fmtDay = () => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const fmtWhen = () => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const hrs = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`

type Tab = 'session' | 'worker' | 'log'

// The selected tab lives in the URL (?tab=worker), so refresh and Back keep it.
function useTabParam(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>('session')
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'worker' || t === 'log' || t === 'session') setTab(t)
  }, [])
  return [
    tab,
    (t) => {
      setTab(t)
      const u = new URL(window.location.href)
      if (t === 'session') u.searchParams.delete('tab')
      else u.searchParams.set('tab', t)
      window.history.replaceState(null, '', u)
    },
  ]
}

function BookingPicker({ L, onBooked }: { L: LabData; onBooked: () => void }) {
  const uid = useId()
  const nights = useMemo(() => bookNights(L), [L])
  const [night, setNight] = useState(0)
  const [sel, setSel] = useState<{ s: number; e: number } | null>(null)
  const [note, setNote] = useState('SeedVR2 video upscaling')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const n = nights[Math.min(night, nights.length - 1)]
  const usable = (i: number) => !!n?.slots[i] && !n.slots[i].booking && !n.slots[i].soon

  function clickSlot(i: number) {
    setError('')
    if (sel && i > sel.s && n.slots.slice(sel.s, i + 1).every((_, k) => usable(sel.s + k)) && (sel.e === sel.s || i !== sel.e)) {
      setSel({ s: sel.s, e: i })
    } else {
      setSel({ s: i, e: i })
    }
  }

  const start = n && sel ? n.slots[sel.s].start : 0
  const end = n && sel ? n.slots[sel.e].end : 0
  const hours = sel ? (end - start) / 3600 : 0
  const problem = sel ? pickProblem(L, start, hours) : ''
  const left = sel ? weekLeft(L, start) : null

  async function book(e: React.FormEvent) {
    e.preventDefault()
    if (!sel) return setError('Pick a start hour, then the hour to finish on.')
    if (problem) return setError(problem)
    if (!note.trim()) return setError('Add a short note saying what the session is for.')
    setBusy(true)
    setError('')
    try {
      await api('/api/lab', { method: 'POST', body: JSON.stringify({ action: 'book', start, hours, note }) })
      toast.success(`Booked ${fmtWhen().format(start * 1000)}. A Chief approves it; you’ll get a DM.`)
      setSel(null)
      onBooked()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!nights.length) return <p className="text-sm text-muted-foreground">No nights are open for booking right now.</p>
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <form onSubmit={book} noValidate>
      <FieldGroup className="gap-5">
        <FieldSet>
          <FieldLegend variant="label">Night</FieldLegend>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Night">
            {nights.map((x, i) => {
              const on = i === night
              const name = i === 0 && x.open - Date.now() / 1000 < 20 * 3600 ? 'Tonight' : new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(x.open * 1000)
              return (
                <button
                  key={x.open}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!x.free}
                  onClick={() => {
                    setNight(i)
                    setSel(null)
                    setError('')
                  }}
                  className={cn(
                    'relative grid min-w-0 gap-0.5 rounded-lg border px-2.5 py-2 text-left text-xs transition-[color,background-color,border-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40',
                    on ? 'border-foreground text-foreground' : 'text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                  )}
                >
                  {on && <motion.span layoutId={`${uid}-night`} className="absolute inset-0 rounded-[inherit] bg-muted" aria-hidden />}
                  <span className="relative font-medium text-foreground">{name}</span>
                  <span className="relative">{new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(x.open * 1000)}</span>
                  <span className="relative tabular-nums">{x.free ? `${x.free} h free` : 'Full'}</span>
                </button>
              )
            })}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Hours</FieldLegend>
          <FieldDescription className="-mt-1">Click the hour to start, then the hour to finish on. Times are in your timezone ({tz}).</FieldDescription>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {n.slots.map((s, i) => {
              const picked = !!sel && i >= sel.s && i <= sel.e
              const state = s.booking ? (s.booking.mine ? 'Yours' : 'Taken') : s.soon ? 'Too soon' : picked ? 'Picked' : 'Free'
              return (
                <button
                  key={s.start}
                  type="button"
                  aria-pressed={picked}
                  disabled={!usable(i)}
                  onClick={() => clickSlot(i)}
                  title={`${fmtHour().format(s.start * 1000)} to ${fmtHour().format(s.end * 1000)}: ${state}`}
                  className={cn(
                    'grid h-12 place-items-center rounded-md border text-xs tabular-nums transition-[color,background-color,border-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    picked ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-foreground/40',
                    !usable(i) && 'cursor-not-allowed border-dashed text-muted-foreground/60 line-through decoration-muted-foreground/40',
                  )}
                >
                  <span className="font-medium no-underline">{fmtHour().format(s.start * 1000)}</span>
                  {!usable(i) && <span className="text-[10px] no-underline">{state}</span>}
                </button>
              )
            })}
          </div>
          <AnimatePresence initial={false}>
            {sel && (
              <motion.p key="sum" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm tabular-nums" aria-live="polite">
                {fmtDay().format(start * 1000)}, {fmtHour().format(start * 1000)} to {fmtHour().format(end * 1000)} · {hrs(hours)}
                {left && <span className="text-muted-foreground"> · {hrs(left.mine)} of your {hrs(left.cap)} left that week</span>}
              </motion.p>
            )}
          </AnimatePresence>
        </FieldSet>

        <Field>
          <FieldLabel htmlFor={`${uid}-note`}>What It’s For</FieldLabel>
          <Input id={`${uid}-note`} name="note" maxLength={500} className="h-9" placeholder="SeedVR2 video upscaling…" value={note} onChange={(e) => setNote(e.target.value)} />
          <FieldDescription>A Chief reads this before approving.</FieldDescription>
        </Field>

        {(error || problem) && <FieldError role="alert">{error || problem}</FieldError>}

        <div>
          <PendingButton type="submit" className="h-9 px-4" pending={busy} pendingLabel="Booking…">
            Book Session
          </PendingButton>
        </div>
      </FieldGroup>
    </form>
  )
}

export function SparkPanel({
  lab,
  worker,
  workerOnline,
  now,
  reload,
}: {
  lab: LabResp | null
  worker: WorkerStatus | null
  workerOnline: boolean
  now: number
  reload: () => void
}) {
  const [tab, setTab] = useTabParam()
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState('')
  const [showCmd, setShowCmd] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'end' } | { kind: 'cancel'; id: number; when: string }>(null)
  const L = lab?.lab.ok && lab.lab.data && typeof lab.lab.data === 'object' ? (lab.lab.data as LabData) : null
  const session = L?.session ?? null
  const myBookings = (L?.bookings ?? []).filter((b) => b.mine && b.status !== 'cancelled')
  const week = L ? weekLeft(L, Date.now() / 1000) : null
  const rules = rulesOf(L)

  async function post(action: string, body: Record<string, unknown> = {}, ok?: string, key = action) {
    setBusy(key)
    try {
      const r = await api<Record<string, unknown>>('/api/lab', { method: 'POST', body: JSON.stringify({ action, ...body }) })
      if (action === 'start-worker') setResult(String(r.output ?? ''))
      if (ok) toast.success(ok)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
      if (action === 'start-worker') setResult((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Section
      id="spark"
      title="Spark"
      delay={0.1}
      description="Book a night, then start the worker while the session runs."
      action={
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh Spark status" onClick={reload}>
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      }
    >
      {lab && !lab.lab.ok && (
        <Alert className="mb-5">
          <AlertTitle>The Spark Didn’t Answer</AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">
            {typeof lab.lab.data === 'string' ? lab.lab.data : JSON.stringify(lab.lab.data)}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="w-full">
          <TabsTrigger value="session">Session</TabsTrigger>
          <TabsTrigger value="worker">Worker</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>

        <TabsContent value="session" className="mt-4">
          <Swap id="session" className="grid gap-6">
            {!lab ? (
              <div className="grid gap-2" aria-hidden>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <>
                {session && (
                  <Item variant="outline" className="flex-wrap rounded-lg">
                    <ItemContent>
                      <ItemTitle>{session.starting ? 'Your Session Is Starting' : 'Your Session Is Running'}</ItemTitle>
                      <ItemDescription className="tabular-nums">
                        Ends {fmtHour().format(session.until * 1000)} ({ago(session.until * 1000, now)}).
                        {rules.idleMinutes ? ` Ends early after ${rules.idleMinutes} min idle.` : ''}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="flex-wrap">
                      <PendingButton variant="outline" size="sm" pending={busy === 'time+'} onClick={() => post('time', { id: session.booking_id, hours: 1 }, 'Added an hour.', 'time+')}>
                        Add 1 Hour
                      </PendingButton>
                      <PendingButton variant="ghost" size="sm" pending={busy === 'time-'} onClick={() => post('time', { id: session.booking_id, hours: -1 }, 'Gave back an hour.', 'time-')}>
                        Give Back 1 Hour
                      </PendingButton>
                      <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'end' })}>
                        End Now…
                      </Button>
                    </ItemActions>
                  </Item>
                )}

                {week && (
                  <div className="grid gap-1.5">
                    <div className="flex justify-between text-sm tabular-nums">
                      <span>This Week</span>
                      <span className="text-muted-foreground">
                        {hrs(week.used)} of {hrs(week.cap)} used
                      </span>
                    </div>
                    <Bar value={(week.used / Math.max(1, week.cap)) * 100} label="Lab hours used this week" />
                  </div>
                )}

                {myBookings.length > 0 && (
                  <div className="grid gap-2">
                    <h3 className="text-sm font-medium">Your Bookings</h3>
                    <ul className="grid gap-2">
                      {myBookings.map((b) => {
                        const when = `${fmtWhen().format(b.start * 1000)} to ${fmtHour().format(b.end * 1000)}`
                        return (
                          <li key={b.id}>
                            <Item variant="outline" size="sm" className="flex-wrap rounded-lg">
                              <ItemContent>
                                <ItemTitle className="tabular-nums">{when}</ItemTitle>
                                <ItemDescription className="line-clamp-none">{hrs((b.end - b.start) / 3600)}{b.note ? ` · ${b.note}` : ''}</ItemDescription>
                              </ItemContent>
                              <ItemActions className="w-full justify-between sm:w-auto">
                                <Badge variant={b.status === 'approved' || b.status === 'active' ? 'secondary' : 'outline'}>
                                  {b.status === 'pending' ? 'Waiting for a Chief' : b.status === 'active' ? 'Running' : b.status[0].toUpperCase() + b.status.slice(1)}
                                </Badge>
                                {b.status !== 'active' && (
                                  <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'cancel', id: b.id, when })}>
                                    Cancel…
                                  </Button>
                                )}
                              </ItemActions>
                            </Item>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {L && (
                  <div className="grid gap-3">
                    <h3 className="text-sm font-medium">Book a Session</h3>
                    <BookingPicker L={L} onBooked={reload} />
                  </div>
                )}
              </>
            )}
          </Swap>
        </TabsContent>

        <TabsContent value="worker" className="mt-4">
          <Swap id="worker" className="grid gap-5">
            <Item variant="outline" className="rounded-lg">
              <ItemContent>
                <ItemTitle>
                  <StatusBadge on={workerOnline}>{worker ? (workerOnline ? `Worker ${worker.state}` : 'Worker offline') : 'Never connected'}</StatusBadge>
                </ItemTitle>
                <ItemDescription className="line-clamp-3">
                  {worker?.message || (worker ? `Last seen ${ago(worker.lastSeen, now)}.` : 'Start it while a session is running.')}
                  {worker?.version ? ` · v${worker.version}` : ''}
                </ItemDescription>
              </ItemContent>
            </Item>

            {worker?.env && (
              <KV
                items={(['gpu', 'torch', 'torchvision', 'cuda', 'python', 'workspaceFreeGB'] as const)
                  .filter((k) => worker.env?.[k] != null)
                  .map((k): [string, React.ReactNode] => [
                    k === 'workspaceFreeGB' ? 'Free disk' : k === 'gpu' ? 'GPU' : k === 'cuda' ? 'CUDA' : k[0].toUpperCase() + k.slice(1),
                    <span key={k} className="font-mono text-xs" translate="no">
                      {String(worker.env?.[k])}
                      {k === 'workspaceFreeGB' ? ' GB' : ''}
                    </span>,
                  ])}
              />
            )}

            <div className="flex flex-wrap gap-2">
              <PendingButton
                className="h-9 px-4"
                pending={busy === 'start-worker'}
                pendingLabel="Starting…"
                disabled={workerOnline}
                onClick={() => post('start-worker', {}, 'Worker started. It checks its setup, then picks up queued jobs.')}
              >
                {workerOnline ? 'Worker Running' : 'Start Worker'}
              </PendingButton>
              {lab?.startCommand && (
                <Button variant="outline" className="h-9" aria-expanded={showCmd} onClick={() => setShowCmd((v) => !v)}>
                  {showCmd ? 'Hide Manual Command' : 'Manual Command'}
                </Button>
              )}
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">Needs a running session. The first start installs tools and downloads the model, which takes a few minutes.</p>

            <AnimatePresence initial={false}>
              {showCmd && lab?.startCommand && (
                <motion.div key="cmd" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-2">
                  <p className="text-xs text-muted-foreground">
                    Or paste this into a JupyterLab terminal in your session. It contains the worker secret, so keep it private.
                  </p>
                  <LogBlock lines={[lab.startCommand]} label="Manual start command" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => navigator.clipboard.writeText(lab.startCommand ?? '').then(() => toast.success('Copied the command.'))}
                  >
                    <Copy aria-hidden />
                    Copy Command
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {result && <LogBlock lines={[result]} label="Start output" />}
          </Swap>
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <Swap id="log">
            {lab && lab.workerLog.length > 0 ? (
              <LogBlock lines={lab.workerLog.slice(-150)} label="Worker log" className="max-h-96" />
            ) : (
              <p className="text-sm text-muted-foreground">No worker output yet. It appears here once the worker starts.</p>
            )}
          </Swap>
        </TabsContent>
      </Tabs>

      <Confirm
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'end' ? 'End Your Session Now?' : 'Cancel This Booking?'}
        description={
          confirm?.kind === 'end'
            ? 'Running jobs stop and resume next session. Your files are kept, and inference comes back in a few minutes.'
            : `The booking for ${confirm && confirm.kind === 'cancel' ? confirm.when : ''} is released for others.`
        }
        confirmLabel={confirm?.kind === 'end' ? 'End Session' : 'Cancel Booking'}
        onConfirm={() => {
          if (confirm?.kind === 'end') post('end', {}, 'Session ended. Your files are kept.')
          else if (confirm?.kind === 'cancel') post('cancel', { id: confirm.id }, 'Booking cancelled.')
          setConfirm(null)
        }}
      />
    </Section>
  )
}
