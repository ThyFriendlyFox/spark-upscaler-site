'use client'

import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Download, Layers, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Confirm } from '@/components/confirm'
import { Bar } from '@/components/motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDuration, modelLabel } from '@/lib/estimate'
import type { Job } from '@/lib/store'
import { cn } from '@/lib/utils'
import { LogBlock, PHASES, Section, ago, api, fmtBytes, jobEta } from './shared'

const STATUS: Record<Job['status'], { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  queued: { label: 'Queued', variant: 'outline' },
  running: { label: 'Running', variant: 'default' },
  uploading: { label: 'Uploading', variant: 'default' },
  done: { label: 'Done', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'outline' },
  canceled: { label: 'Canceled', variant: 'outline' },
}

type Patch = (id: string, change: Partial<Job> | null) => void

// Results stay on the Spark. The direct link uses your Spark sign-in in this browser; the app route
// streams it with the lab token instead.
function downloadLinks(j: Job, sparkUrl?: string) {
  const out = j.output
  if (!out) return null
  const viaApp = `/api/jobs/${j.id}/download`
  const direct = out.path && sparkUrl ? `${sparkUrl}/api/lab/files/${out.path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}` : null
  return { direct, viaApp }
}

function JobRow({ j, now, reload, patch, sparkUrl }: { j: Job; now: number; reload: () => void; patch: Patch; sparkUrl?: string }) {
  const [logOpen, setLogOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const p = j.progress
  const live = j.status === 'running' || j.status === 'uploading'
  const chunks = p?.chunks ?? j.estimate?.chunks ?? 0
  const doneChunks = p?.chunksDone ?? 0
  const perChunk = j.estimate ? j.estimate.seconds / Math.max(1, j.estimate.chunks) : 1
  const inChunk = j.status === 'running' && p?.chunkElapsed ? Math.min(0.95, p.chunkElapsed / Math.max(1, perChunk)) : 0
  const pct = j.status === 'done' ? 100 : chunks ? ((doneChunks + inChunk) / chunks) * 100 : 0
  const eta = jobEta(j)
  const actual = j.wallSeconds
  const off = actual && j.estimate ? Math.round(((actual - j.estimate.seconds) / j.estimate.seconds) * 100) : null
  const st = STATUS[j.status]
  const label = live ? (PHASES[p?.phase ?? ''] ?? st.label) : st.label
  const canCancel = j.status === 'queued' || j.status === 'running'
  const canRetry = (j.status === 'failed' || j.status === 'canceled') && !j.input.deleted
  const links = downloadLinks(j, sparkUrl)

  // Optimistic: show the change at once, roll back if the server says no.
  async function act(action: 'cancel' | 'retry' | 'forget-stats') {
    if (action === 'cancel') patch(j.id, { status: 'canceled' })
    if (action === 'retry') patch(j.id, { status: 'queued', error: undefined })
    try {
      const r = await api<{ removed?: number }>(`/api/jobs/${j.id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      if (action === 'forget-stats') toast(`Removed ${r.removed ?? 0} data points from the stats.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      reload()
    }
  }
  async function remove() {
    patch(j.id, null)
    try {
      await api(`/api/jobs/${j.id}`, { method: 'DELETE' })
      toast(`Deleted ${j.name}.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      reload()
    }
  }

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      <Item variant="outline" className={cn('flex-wrap rounded-lg', live && 'border-foreground/40')}>
        <ItemContent className="min-w-0">
          <ItemTitle className="w-full min-w-0">
            <span className="truncate">{j.name}</span>
            <Badge variant={st.variant} className={cn('shrink-0', j.status === 'failed' && 'border-foreground font-semibold')}>
              {label}
            </Badge>
          </ItemTitle>
          <ItemDescription className="line-clamp-none tabular-nums">
            {j.meta.width}×{j.meta.height} → {j.estimate?.outW}×{j.estimate?.outH} · <span translate="no">{modelLabel(j.settings.model)}</span> · batch{' '}
            {j.settings.batchSize} · {j.probe?.frames ?? j.meta.frames} frames · {fmtBytes(j.size)} · added {ago(j.createdAt, now)}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          {links ? (
            <Button variant="outline" size="sm" asChild>
              <a href={links.direct ?? links.viaApp} target="_blank" rel="noreferrer">
                <Download aria-hidden />
                Download
              </a>
            </Button>
          ) : canRetry ? (
            <Button variant="outline" size="sm" onClick={() => act('retry')}>
              Retry
            </Button>
          ) : canCancel ? (
            <Button variant="outline" size="sm" onClick={() => act('cancel')}>
              Cancel
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${j.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {links?.direct && (
                <DropdownMenuItem asChild>
                  <a href={links.direct} target="_blank" rel="noreferrer">
                    Download From Spark
                  </a>
                </DropdownMenuItem>
              )}
              {links && (
                <DropdownMenuItem asChild>
                  <a href={links.viaApp} target="_blank" rel="noreferrer">
                    Download via App
                  </a>
                </DropdownMenuItem>
              )}
              {canCancel && <DropdownMenuItem onSelect={() => act('cancel')}>Cancel Job</DropdownMenuItem>}
              {canRetry && <DropdownMenuItem onSelect={() => act('retry')}>Retry</DropdownMenuItem>}
              {j.status === 'done' && <DropdownMenuItem onSelect={() => act('forget-stats')}>Drop From Stats</DropdownMenuItem>}
              {!live && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirmDelete(true)}>Delete…</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>

        <ItemFooter className="flex-col items-stretch gap-2">
          {live && (
            <div className="grid gap-1.5">
              <Bar value={Math.max(2, pct)} label={`Progress of ${j.name}`} />
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums" aria-live="polite">
                <span>
                  {chunks ? `Chunk ${Math.min(doneChunks + 1, chunks)} of ${chunks}` : 'Starting'}
                  {p?.chunkElapsed ? `, ${fmtDuration(p.chunkElapsed)} in` : ''}
                  {p?.updatedAt && now - p.updatedAt > 120_000 ? ` · no update ${ago(p.updatedAt, now)}` : ''}
                </span>
                {eta != null && <span className="text-foreground">About {fmtDuration(eta)} left</span>}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground tabular-nums">
            Estimate {fmtDuration(j.estimate?.seconds)}
            {actual ? `, took ${fmtDuration(actual)}${off != null ? ` (${off > 0 ? '+' : ''}${off}%)` : ''}` : ''}
            {j.output ? ` · ${fmtBytes(j.output.size)}` : ''}
            {j.attempts > 1 ? ` · ${j.attempts} sessions` : ''}
            {j.timings?.dryRun ? ' · dry run' : ''}
          </p>
          {j.error && (
            <p role="alert" className="rounded-md border border-foreground/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
              {j.error}
            </p>
          )}
          {j.logTail && j.logTail.length > 0 && (j.status === 'failed' || live) && (
            <Collapsible open={logOpen} onOpenChange={setLogOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground">
                  <motion.span animate={{ rotate: logOpen ? 180 : 0 }} className="inline-flex">
                    <ChevronDown aria-hidden />
                  </motion.span>
                  {logOpen ? 'Hide Log' : 'Show Log'}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <LogBlock lines={j.logTail} label={`Log for ${j.name}`} className="mt-2" />
              </CollapsibleContent>
            </Collapsible>
          )}
        </ItemFooter>
      </Item>
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${j.name}?`}
        description={
          j.output?.path
            ? 'This removes the job here, and the worker deletes the video from the Spark the next time it runs. Its timing data stays in the stats.'
            : 'This removes the job and its files. Its timing data stays in the stats.'
        }
        confirmLabel="Delete Job"
        onConfirm={remove}
      />
    </motion.li>
  )
}

export function Jobs({
  jobs,
  loading,
  now,
  reload,
  patch,
  sparkUrl,
}: {
  jobs: Job[]
  loading: boolean
  now: number
  reload: () => void
  patch: Patch
  sparkUrl?: string
}) {
  const hasResults = jobs.some((j) => j.output?.path)
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'uploading').length
  const queued = jobs.filter((j) => j.status === 'queued').length
  return (
    <Section
      id="jobs"
      title="Jobs"
      delay={0.05}
      description={jobs.length ? `${running} running, ${queued} queued, ${jobs.length} total.` : 'Queued, running and finished upscales.'}
    >
      {loading ? (
        <div className="grid gap-3" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : !jobs.length ? (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Layers aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No Jobs Yet</EmptyTitle>
            <EmptyDescription>Upload a clip above. It waits here until the worker runs in a session.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          <AnimatePresence initial={false}>
            {jobs.map((j) => (
              <JobRow key={j.id} j={j} now={now} reload={reload} patch={patch} sparkUrl={sparkUrl} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {hasResults && (
        <p className="mt-4 text-xs text-pretty text-muted-foreground">
          Results stay on the Spark and download straight from it, so sign in at{' '}
          <a href={sparkUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            the Spark site
          </a>{' '}
          in this browser first. If you can’t, use Download via App in the ⋯ menu; it relays the file through this site and must finish within 5 minutes.
        </p>
      )}
    </Section>
  )
}
