'use client'

import { LogOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBadge } from '@/components/brand'
import { Reveal } from '@/components/motion'
import { Guide } from '@/components/dashboard/guide'
import { Jobs } from '@/components/dashboard/jobs'
import { NewJob } from '@/components/dashboard/new-job'
import { SetupNotice } from '@/components/dashboard/setup-notice'
import { api, type JobsResp, type LabResp, type Setup, type StatsResp } from '@/components/dashboard/shared'
import { SparkPanel } from '@/components/dashboard/spark-panel'
import { Stats } from '@/components/dashboard/stats'
import { Button } from '@/components/ui/button'
import type { LabData } from '@/lib/booking'
import type { Job } from '@/lib/store'

export default function Dashboard() {
  const [data, setData] = useState<JobsResp | null>(null)
  const [lab, setLab] = useState<LabResp | null>(null)
  const [stats, setStats] = useState<StatsResp | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const doneCount = useRef(-1)

  const loadJobs = useCallback(async () => {
    try {
      const d = await api<JobsResp>('/api/jobs')
      setData(d)
      const done = d.jobs.filter((j) => j.status === 'done').length
      if (done !== doneCount.current) {
        doneCount.current = done
        if (d.setup.redis) api<StatsResp>('/api/stats').then(setStats).catch(() => setStats({ chunks: [], jobs: [], fits: { levels: {}, jobOverhead: 90, jobOverheadN: 0 } }))
        else setStats({ chunks: [], jobs: [], fits: { levels: {}, jobOverhead: 90, jobOverheadN: 0 } })
      }
    } catch (e) {
      setData((prev) => prev ?? { setup: {} as Setup, jobs: [], worker: null, error: (e as Error).message })
    }
  }, [])

  const loadLab = useCallback(async () => {
    try {
      setLab(await api<LabResp>('/api/lab'))
    } catch (e) {
      setLab({ lab: { ok: false, status: 0, data: (e as Error).message }, workerLog: [], startCommand: null })
    }
  }, [])

  useEffect(() => {
    loadJobs()
    loadLab()
    const a = setInterval(() => document.visibilityState === 'visible' && loadJobs(), 8000)
    const b = setInterval(() => document.visibilityState === 'visible' && loadLab(), 30000)
    const c = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(a)
      clearInterval(b)
      clearInterval(c)
    }
  }, [loadJobs, loadLab])

  // Optimistic edits to one job (null removes it) until the next poll reconciles.
  const patch = useCallback((id: string, change: Partial<Job> | null) => {
    setData((d) =>
      d ? { ...d, jobs: change === null ? d.jobs.filter((j) => j.id !== id) : d.jobs.map((j) => (j.id === id ? { ...j, ...change } : j)) } : d,
    )
  }, [])

  const setup = data?.setup
  const jobs = data?.jobs ?? []
  const worker = data?.worker ?? null
  const workerOnline = !!worker && now - worker.lastSeen < 90_000
  const L = lab?.lab.ok && lab.lab.data && typeof lab.lab.data === 'object' ? (lab.lab.data as LabData) : null
  const sessionLive = !!L?.session
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'uploading').length

  // The tab title says what's happening, so it reads at a glance from another tab.
  useEffect(() => {
    document.title = running ? `${running} running · Spark Upscaler` : 'Spark Upscaler'
  }, [running])

  return (
    <div className="mx-auto w-full max-w-6xl px-[max(1rem,env(safe-area-inset-left))] pt-6 pb-16 sm:px-6">
      <Reveal>
        <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-b pb-5">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold tracking-tight">Spark Upscaler</h1>
            <p className="text-sm text-muted-foreground">
              <span translate="no">SeedVR2</span> video upscaling on the community <span translate="no">DGX Spark</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <StatusBadge on={sessionLive}>{!lab ? 'Checking Spark…' : !lab.lab.ok ? 'Spark unavailable' : sessionLive ? 'Session running' : 'No session'}</StatusBadge>
            <StatusBadge on={workerOnline}>{workerOnline ? `Worker ${worker?.state}` : 'Worker offline'}</StatusBadge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST' })
              window.location.href = '/login'
            }}
          >
            <LogOut aria-hidden />
            Sign Out
          </Button>
        </header>
      </Reveal>

      <main id="main" className="grid gap-6">
        {data?.error && (
          <p role="alert" className="rounded-lg border border-foreground/60 px-4 py-3 text-sm">
            {data.error}
          </p>
        )}
        {setup && <SetupNotice setup={setup} />}

        <Guide
          s={{
            booked: (L?.bookings ?? []).some((b) => b.mine && b.status !== 'cancelled' && b.status !== 'denied'),
            sessionLive,
            workerOnline,
            queued: jobs.some((j) => j.status === 'queued' || j.status === 'running' || j.status === 'uploading'),
            done: jobs.some((j) => j.status === 'done'),
          }}
        />

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:col-span-7">
            <NewJob fits={stats?.fits ?? null} storageReady={!!setup?.blob && !!setup?.redis} onCreated={loadJobs} />
            <Jobs jobs={jobs} loading={!data} now={now} reload={loadJobs} patch={patch} sparkUrl={data?.sparkUrl} />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:col-span-5">
            <SparkPanel lab={lab} worker={worker} workerOnline={workerOnline} now={now} reload={loadLab} />
            <Stats stats={stats} loading={!stats} />
          </div>
        </div>
      </main>
    </div>
  )
}
