'use client'

import { motion } from 'motion/react'
import { Activity } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtDuration, modelLabel, workUnits } from '@/lib/estimate'
import { Section, type StatsResp } from './shared'

// Models are told apart by marker shape, not color.
const MARKERS = ['filled', 'hollow', 'square', 'cross'] as const
type MarkerKind = (typeof MARKERS)[number]

function Marker({ kind, x, y }: { kind: MarkerKind; x: number; y: number }) {
  if (kind === 'filled') return <circle cx={x} cy={y} r={3.5} className="fill-foreground" />
  if (kind === 'hollow') return <circle cx={x} cy={y} r={3.5} className="fill-card stroke-foreground" strokeWidth={1.5} />
  if (kind === 'square') return <rect x={x - 3.5} y={y - 3.5} width={7} height={7} className="fill-foreground" />
  return <path d={`M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}`} className="stroke-foreground" strokeWidth={1.5} />
}

export function Stats({ stats, loading }: { stats: StatsResp | null; loading: boolean }) {
  const chunks = stats?.chunks ?? []
  const fits = stats?.fits
  const models = Array.from(new Set(chunks.map((c) => c.model)))
  const marker = (m: string) => MARKERS[models.indexOf(m) % MARKERS.length]

  const W = 520
  const H = 220
  const pad = { l: 52, r: 12, t: 10, b: 32 }
  const xs = chunks.map((c) => workUnits(c.frames, c.outW, c.outH))
  const ys = chunks.map((c) => c.seconds)
  const xMax = Math.max(1, ...xs) * 1.08
  const yMax = Math.max(60, ...ys) * 1.12
  const sx = (x: number) => pad.l + (x / xMax) * (W - pad.l - pad.r)
  const sy = (y: number) => H - pad.b - (y / yMax) * (H - pad.t - pad.b)

  const rows = fits
    ? Object.entries(fits.levels)
        .filter(([k]) => k.split('|').length === 1 || k.split('|').length === 5)
        .sort((a, b) => a[0].localeCompare(b[0]))
    : []
  const recent = (stats?.jobs ?? []).slice(-12).reverse()

  return (
    <Section
      id="stats"
      title="Timing Stats"
      delay={0.15}
      description={
        chunks.length
          ? `${chunks.length} chunks from ${stats?.jobs.length ?? 0} jobs. Every finished chunk sharpens the estimates.`
          : 'How long upscales take on the Spark, learned from your own runs.'
      }
    >
      {loading ? (
        <Skeleton className="h-48 w-full" aria-hidden />
      ) : chunks.length === 0 ? (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Activity aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No Runs Yet</EmptyTitle>
            <EmptyDescription>
              Until the first chunks finish, estimates use a rough guess. After that they fit{' '}
              <span className="font-mono text-xs" translate="no">
                time = runs × a + work × b
              </span>{' '}
              per model.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <figure className="grid gap-2">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Scatter plot of ${chunks.length} chunks: seconds against megapixel-frames, with fitted lines per model.`}>
              {[0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={pad.l} x2={W - pad.r} y1={sy(yMax * f)} y2={sy(yMax * f)} className="stroke-border" />
                  <text x={pad.l - 8} y={sy(yMax * f) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                    {fmtDuration(yMax * f)}
                  </text>
                  <text x={sx(xMax * f)} y={H - pad.b + 16} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
                    {(xMax * f).toFixed(0)}
                  </text>
                </g>
              ))}
              <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} className="stroke-foreground/60" />
              <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} className="stroke-foreground/60" />
              <text x={(W + pad.l) / 2} y={H - 2} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                megapixel-frames per chunk
              </text>
              {models.map((m) => {
                const f = fits?.levels[m]
                if (!f) return null
                return (
                  <motion.line
                    key={m}
                    x1={sx(0)}
                    y1={sy(f.a)}
                    x2={sx(xMax)}
                    y2={sy(f.a + f.b * xMax)}
                    className="stroke-muted-foreground"
                    strokeDasharray="4 3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                  />
                )
              })}
              {chunks.map((c, i) => (
                <motion.g key={`${c.jobId}-${c.chunk}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 30) * 0.015 }}>
                  <title>{`${modelLabel(c.model)} · ${c.frames} frames at ${c.outW}×${c.outH} · ${fmtDuration(c.seconds)}`}</title>
                  <Marker kind={marker(c.model)} x={sx(xs[i])} y={sy(ys[i])} />
                </motion.g>
              ))}
            </svg>
            <figcaption className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {models.map((m) => (
                <span key={m} className="inline-flex items-center gap-1.5" translate="no">
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    <Marker kind={marker(m)} x={5} y={5} />
                  </svg>
                  {modelLabel(m)}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <svg width="16" height="10" aria-hidden>
                  <line x1="0" y1="5" x2="16" y2="5" className="stroke-muted-foreground" strokeDasharray="4 3" />
                </svg>
                Fit
              </span>
            </figcaption>
          </figure>

          <Table>
            <TableCaption className="mt-2 text-left text-xs">
              {fits ? `Per-job overhead (download, prepare, join, upload): median ${fmtDuration(fits.jobOverhead)} over ${fits.jobOverheadN} jobs.` : ''}
            </TableCaption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Fit</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Per Run</TableHead>
                <TableHead className="text-right">s per MP·frame</TableHead>
                <TableHead className="text-right">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([k, f]) => {
                const parts = k.split('|')
                return (
                  <TableRow key={k}>
                    <TableCell className="max-w-48 whitespace-normal">
                      <span translate="no">{modelLabel(parts[0])}</span>
                      {parts.length > 1 && <div className="text-xs text-muted-foreground">{parts.slice(1).join(' · ')}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{f.n}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(f.a)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.b.toFixed(3)}</TableCell>
                    <TableCell className="text-right tabular-nums">±{Math.round(f.relErr * 100)}%</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-6 grid gap-2">
          <h3 className="text-sm font-medium">Estimate vs. Actual</h3>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Clip</TableHead>
                <TableHead className="text-right">Estimate → Actual</TableHead>
                <TableHead className="text-right">Off By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((j) => {
                const off = j.estimateSeconds ? Math.round(((j.wallSeconds - j.estimateSeconds) / j.estimateSeconds) * 100) : null
                return (
                  <TableRow key={j.jobId + j.ts}>
                    <TableCell className="max-w-48 whitespace-normal">
                      <div className="truncate">{j.name}</div>
                      <div className="text-xs text-muted-foreground">
                        <span translate="no">{modelLabel(j.model)}</span> · {j.frames} frames → {j.outW}×{j.outH}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtDuration(j.estimateSeconds)} → {fmtDuration(j.wallSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{off == null ? '–' : `${off > 0 ? '+' : ''}${off}%`}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  )
}
