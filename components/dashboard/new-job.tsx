'use client'

import { upload } from '@vercel/blob/client'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, FileVideo, Upload, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AnimatedNumber, Bar } from '@/components/motion'
import { PendingButton } from '@/components/pending-button'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  ATTENTION_MODES,
  BATCH_SIZES,
  COLOR_CORRECTIONS,
  DEFAULT_SETTINGS,
  MODELS,
  RESOLUTIONS,
  estimateJob,
  fmtDuration,
  type FitSet,
  type Meta,
  type Settings,
} from '@/lib/estimate'
import { cn } from '@/lib/utils'
import { readVideoMeta } from '@/lib/videoMeta'
import { KV, SESSION_HOURS_WEEK, Section, api, fmtBytes } from './shared'

function Pick({ id, value, onChange, options }: { id: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-9 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function NumberField({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} type="number" inputMode="numeric" className="h-9" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

export function NewJob({ fits, storageReady, onCreated }: { fits: FitSet | null; storageReady: boolean; onCreated: () => void }) {
  const uid = useId()
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [reading, setReading] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [over, setOver] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)

  // Remember the last settings in this browser only.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('su:settings') ?? '{}')
      if (MODELS.some((m) => m.id === saved.model)) setSettings({ ...DEFAULT_SETTINGS, ...saved })
    } catch {}
    loaded.current = true
  }, [])
  useEffect(() => {
    if (!loaded.current) return
    try {
      localStorage.setItem('su:settings', JSON.stringify({ ...settings, extraArgs: '' }))
    } catch {}
  }, [settings])

  // Leaving mid-upload loses the upload, so ask first.
  useEffect(() => {
    if (progress === null) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [progress])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }))

  async function pick(f: File | null | undefined) {
    if (!f) return
    if (f.type && !f.type.startsWith('video/')) {
      setError('That isn’t a video file. Choose an MP4, MOV, MKV or WebM.')
      return
    }
    setFile(f)
    setMeta(null)
    setError('')
    setReading(true)
    try {
      setMeta(await readVideoMeta(f))
    } catch (e) {
      setError(`Couldn’t read the video: ${(e as Error).message}`)
    } finally {
      setReading(false)
    }
  }

  const est = useMemo(() => (meta && meta.width ? estimateJob(meta, settings, fits) : null), [meta, settings, fits])

  async function submit() {
    if (!storageReady) return setError('Storage isn’t connected yet. Finish the setup steps above.')
    if (!file) return setError('Choose a video first.')
    if (!meta) return setError('Still reading the video. Try again in a moment.')
    setError('')
    setProgress(0)
    try {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'video.mp4'
      const blob = await upload(`inputs/${safe}`, file, {
        access: 'private',
        handleUploadUrl: '/api/upload',
        multipart: file.size > 100 * 1024 * 1024,
        contentType: file.type || 'video/mp4',
        onUploadProgress: (e) => setProgress(e.percentage),
      })
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ input: { pathname: blob.pathname, url: blob.url }, name: file.name, size: file.size, contentType: file.type, meta, settings }),
      })
      toast.success(`Queued ${file.name}`)
      setFile(null)
      setMeta(null)
      onCreated()
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  const custom = !RESOLUTIONS.includes(settings.resolution)
  const weekShare = est ? (est.seconds / (SESSION_HOURS_WEEK * 3600)) * 100 : 0
  const ids = { model: `${uid}-model`, res: `${uid}-res`, batch: `${uid}-batch`, custom: `${uid}-custom`, fps: `${uid}-fps`, extra: `${uid}-extra` }

  return (
    <Section
      id="new"
      title="New Upscale"
      description="Pick a clip and settings. The estimate updates as you change them."
      footer={
        <>
          <PendingButton
            className="h-9 px-4"
            pending={progress !== null}
            pendingLabel={`Uploading… ${Math.round(progress ?? 0)}%`}
            onClick={submit}
          >
            <Upload aria-hidden />
            Upload &amp; Queue
          </PendingButton>
          <p className="text-xs text-muted-foreground">The worker picks it up during your next session.</p>
        </>
      }
    >
      <FieldGroup className="gap-6">
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <AnimatePresence mode="wait" initial={false}>
          {file ? (
            <motion.div key="file" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <Item variant="outline" className="rounded-lg">
                <ItemMedia variant="icon">
                  <FileVideo aria-hidden />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full truncate">{file.name}</ItemTitle>
                  <ItemDescription className="tabular-nums">
                    {fmtBytes(file.size)}
                    {reading && ' · Reading…'}
                    {meta && ` · ${meta.width}×${meta.height} · ${meta.duration.toFixed(1)} s · ${meta.frames} frames · ${meta.fps} fps`}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={progress !== null}>
                    Replace
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove video"
                    disabled={progress !== null}
                    onClick={() => {
                      setFile(null)
                      setMeta(null)
                    }}
                  >
                    <X />
                  </Button>
                </ItemActions>
              </Item>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <Empty
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setOver(false)
                  pick(e.dataTransfer.files?.[0])
                }}
                className={cn('gap-3 border border-dashed py-8 transition-colors', over && 'border-foreground bg-muted/60')}
              >
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Upload aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>Drop a Video Here</EmptyTitle>
                  <EmptyDescription>MP4 and MOV give an exact frame count. Files go straight to private storage.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                    Choose a File…
                  </Button>
                </EmptyContent>
              </Empty>
            </motion.div>
          )}
        </AnimatePresence>

        {meta && meta.fpsSource !== 'container' && (
          <Field>
            <FieldLabel htmlFor={ids.fps}>Frame Rate</FieldLabel>
            <Input
              id={ids.fps}
              type="number"
              inputMode="decimal"
              step="0.001"
              className="h-9 w-32"
              value={meta.fps}
              onChange={(e) => {
                const fps = Number(e.target.value) || 24
                setMeta({ ...meta, fps, frames: Math.round(meta.duration * fps) })
              }}
            />
            <FieldDescription>The file didn’t say, so this is a guess. The worker measures the real value.</FieldDescription>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor={ids.model}>Model</FieldLabel>
            <Pick id={ids.model} value={settings.model} onChange={(v) => set('model', v)} options={MODELS.map((m) => [m.id, m.label])} />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.res}>Output Short Side</FieldLabel>
            <Pick
              id={ids.res}
              value={custom ? 'custom' : String(settings.resolution)}
              onChange={(v) => set('resolution', v === 'custom' ? 1200 : Number(v))}
              options={[...RESOLUTIONS.map((r): [string, string] => [String(r), `${r}p${r === 1440 ? ' (2K)' : r === 2160 ? ' (4K)' : ''}`]), ['custom', 'Custom…']]}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.batch}>Batch Size</FieldLabel>
            <Pick id={ids.batch} value={String(settings.batchSize)} onChange={(v) => set('batchSize', Number(v))} options={BATCH_SIZES.map((b) => [String(b), `${b} frames`])} />
          </Field>
          {custom && <NumberField id={ids.custom} label="Custom Short Side (px)" value={settings.resolution} onChange={(v) => set('resolution', v || 1080)} />}
        </div>

        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground">
              <motion.span animate={{ rotate: advanced ? 180 : 0 }} className="inline-flex">
                <ChevronDown aria-hidden />
              </motion.span>
              Advanced Settings
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FieldSet className="mt-4">
              <FieldLegend className="sr-only">Advanced settings</FieldLegend>
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField id={`${uid}-max`} label="Max Long Side" hint="0 means no limit." value={settings.maxResolution} onChange={(v) => set('maxResolution', v)} />
                <NumberField id={`${uid}-chunk`} label="Frames per Chunk" hint="0 picks ~10 min chunks." value={settings.chunkFrames} onChange={(v) => set('chunkFrames', v)} />
                <NumberField id={`${uid}-seed`} label="Seed" value={settings.seed} onChange={(v) => set('seed', v)} />
                <Field>
                  <FieldLabel htmlFor={`${uid}-cc`}>Color Correction</FieldLabel>
                  <Pick id={`${uid}-cc`} value={settings.colorCorrection} onChange={(v) => set('colorCorrection', v)} options={COLOR_CORRECTIONS.map((c) => [c, c])} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${uid}-att`}>Attention</FieldLabel>
                  <Pick id={`${uid}-att`} value={settings.attention} onChange={(v) => set('attention', v)} options={ATTENTION_MODES.map((c) => [c, c])} />
                </Field>
                <NumberField id={`${uid}-pre`} label="Prepend Frames" value={settings.prependFrames} onChange={(v) => set('prependFrames', v)} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Field orientation="horizontal" className="w-auto">
                  <Switch id={`${uid}-compile`} checked={settings.compile} onCheckedChange={(v) => set('compile', v)} />
                  <FieldLabel htmlFor={`${uid}-compile`} className="font-normal">
                    torch.compile
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal" className="w-auto">
                  <Switch id={`${uid}-tile`} checked={settings.vaeTiling} onCheckedChange={(v) => set('vaeTiling', v)} />
                  <FieldLabel htmlFor={`${uid}-tile`} className="font-normal">
                    VAE tiling
                  </FieldLabel>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor={ids.extra}>Extra CLI Flags</FieldLabel>
                <Input
                  id={ids.extra}
                  className="h-9 font-mono"
                  spellCheck={false}
                  autoComplete="off"
                  translate="no"
                  placeholder="--input_noise_scale 0.1…"
                  value={settings.extraArgs}
                  onChange={(e) => set('extraArgs', e.target.value)}
                />
              </Field>
            </FieldSet>
          </CollapsibleContent>
        </Collapsible>

        <AnimatePresence initial={false}>
          {est && meta && (
            <motion.div
              key="estimate"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="rounded-lg border bg-muted/40 p-4"
              aria-live="polite"
            >
              <div className="text-xs text-muted-foreground">Estimated Time on the Spark</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">
                <AnimatedNumber value={est.seconds} format={fmtDuration} />
              </div>
              <div className="mb-4 text-sm text-muted-foreground tabular-nums">
                Likely {fmtDuration(est.low)} to {fmtDuration(est.high)}
              </div>
              <KV
                items={[
                  ['Output', `${est.outW}×${est.outH}`],
                  ['Plan', `${est.chunks} chunk${est.chunks === 1 ? '' : 's'} of up to ${est.chunkFrames} frames, resumable`],
                  ['Based on', est.basis],
                ]}
              />
              <div className="mt-4 grid gap-1.5">
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{est.high > 12 * 3600 ? 'Longer than one 12 h session; it resumes next session' : 'Share of your 12 h weekly lab time'}</span>
                  <span>{Math.round(weekShare)}%</span>
                </div>
                <Bar value={weekShare} label="Share of weekly lab time" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {progress !== null && (
            <motion.div key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Bar value={progress} label="Upload progress" />
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <FieldError role="alert" className="text-sm">
            {error}
          </FieldError>
        )}
      </FieldGroup>
    </Section>
  )
}
