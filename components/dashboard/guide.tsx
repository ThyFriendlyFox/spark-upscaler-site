'use client'

import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Section } from './shared'

export type GuideState = {
  booked: boolean // a booking exists (pending, approved or running)
  sessionLive: boolean
  workerOnline: boolean
  queued: boolean // a job is queued or running
  done: boolean // a job has finished
}

// The four steps, each ticked off from live state, so the page says what to do next.
export function Guide({ s }: { s: GuideState }) {
  const steps = [
    {
      title: 'Book a Session',
      body: 'In the Spark card, pick a night and the hours you need. A Chief approves it and you get a Discord DM. Sessions run 7 PM to 7 AM Eastern.',
      done: s.booked || s.sessionLive,
    },
    {
      title: 'Start the Worker',
      body: 'Once the session is running, open Worker and press Start Worker. The first start installs tools and downloads the model, about 10 to 20 minutes.',
      done: s.workerOnline,
    },
    {
      title: 'Upload a Video',
      body: 'Do this any time, even before the session. Jobs wait in the queue and the worker picks them up in order. The estimate shows the time first.',
      done: s.queued || s.done,
    },
    {
      title: 'Download the Result',
      body: 'Finished videos stay on the Spark and download straight from it, so sign in to the Spark site first. If a session ends mid-job, it resumes next session from the last chunk.',
      done: s.done,
    },
  ]
  const next = steps.findIndex((x) => !x.done)
  return (
    <Section id="guide" title="How It Works" description="Four steps. Each one ticks off as it happens.">
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => {
          const current = i === next
          return (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i }}
              className={cn('grid content-start gap-2 rounded-lg border p-4', current ? 'border-foreground' : '')}
              aria-current={current ? 'step' : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums',
                    step.done ? 'border-primary bg-primary text-primary-foreground' : current ? 'border-foreground' : 'text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {step.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <h3 className="text-sm font-medium">{step.title}</h3>
                <span className="sr-only">{step.done ? '(done)' : current ? '(next step)' : ''}</span>
              </div>
              <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
            </motion.li>
          )
        })}
      </ol>
    </Section>
  )
}
