'use client'

import { Reveal } from '@/components/motion'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { LabData } from '@/lib/booking'
import { workUnits, type ChunkStat, type FitSet, type JobStat } from '@/lib/estimate'
import type { Job, WorkerStatus } from '@/lib/store'
import { cn } from '@/lib/utils'

export type Setup = { appPassword: boolean; sparkLabToken: boolean; workerSecret: boolean; blob: boolean; redis: boolean }
export type JobsResp = { setup: Setup; jobs: Job[]; worker: WorkerStatus | null; now?: number; error?: string }
export type LabResp = { lab: { ok: boolean; status: number; data: LabData | string | null }; workerLog: string[]; startCommand: string | null }
export type StatsResp = { chunks: ChunkStat[]; jobs: JobStat[]; fits: FitSet }

export const SESSION_HOURS_WEEK = 12

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  if (r.status === 401 && !url.startsWith('/api/lab')) {
    window.location.href = '/login'
    throw new Error('Not signed in')
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Something went wrong (HTTP ${r.status}). Try again.`)
  return data as T
}

export function fmtBytes(n: number) {
  if (!n) return '–'
  if (n < 1e6) return `${(n / 1e3).toFixed(0)} KB`
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`
  return `${(n / 1e9).toFixed(2)} GB`
}

const RTF = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null
export function ago(ts: number | undefined, now: number) {
  if (!ts || !RTF) return 'never'
  const s = Math.round((ts - now) / 1000)
  const a = Math.abs(s)
  if (a < 60) return RTF.format(s, 'second')
  if (a < 3600) return RTF.format(Math.round(s / 60), 'minute')
  if (a < 86400) return RTF.format(Math.round(s / 3600), 'hour')
  return RTF.format(Math.round(s / 86400), 'day')
}

export function jobEta(job: Job): number | null {
  const est = job.estimate
  const p = job.progress
  if (!est || !p) return null
  if (job.status === 'uploading') return 30
  if (job.status !== 'running') return null
  const frames = job.probe?.frames ?? job.meta.frames
  const totalWork = workUnits(frames, est.outW, est.outH)
  const done = p.doneWork ?? 0
  // Once a chunk has finished, trust this job's own speed over the model.
  const rate = done > 0 && p.doneSeconds ? p.doneSeconds / done : null
  const remainingWork = Math.max(0, totalWork - done)
  const remainingChunks = Math.max(0, (p.chunks ?? est.chunks) - (p.chunksDone ?? 0))
  const secs = rate ? remainingWork * rate : remainingChunks * est.a + remainingWork * est.b
  return Math.max(0, secs - (p.chunkElapsed ?? 0) + 60)
}

export const PHASES: Record<string, string> = {
  claimed: 'Starting',
  downloading: 'Downloading',
  preparing: 'Preparing frames',
  probed: 'Loading model',
  upscaling: 'Upscaling',
  joining: 'Joining chunks',
  uploading: 'Uploading',
}

// Every section on the page is this card, so headings, spacing and edges match.
export function Section({
  id,
  title,
  description,
  action,
  footer,
  children,
  delay = 0,
  className,
}: {
  id: string
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <Reveal delay={delay} className={cn('min-w-0', className)}>
      <section id={id} aria-labelledby={`${id}-title`}>
        <Card className="gap-5 rounded-xl py-5 shadow-card ring-1 ring-border [--card-spacing:--spacing(5)]">
          <CardHeader>
            <CardTitle>
              <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
                {title}
              </h2>
            </CardTitle>
            {description && <CardDescription className="text-pretty">{description}</CardDescription>}
            {action && <CardAction>{action}</CardAction>}
          </CardHeader>
          <CardContent>{children}</CardContent>
          {footer && <CardFooter className="gap-2 border-t bg-transparent pt-5">{footer}</CardFooter>}
        </Card>
      </section>
    </Reveal>
  )
}

export function KV({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 tabular-nums [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function LogBlock({ lines, className, label }: { lines: string[]; className?: string; label: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className={cn(
        'max-h-64 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      {lines.join('\n')}
    </pre>
  )
}
