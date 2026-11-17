'use client'

import { animate, motion, useMotionValue, useMotionValueEvent } from 'motion/react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const EASE = [0.2, 0, 0, 1] as const

// Fades a block up into place. Used once per section on first paint, staggered by `delay`.
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay, ease: EASE }} className={className}>
      {children}
    </motion.div>
  )
}

// A progress bar that animates with transform (scaleX), not width, so it stays on the compositor.
export function Bar({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <motion.div
        className="h-full w-full origin-left rounded-full bg-primary"
        initial={false}
        animate={{ scaleX: v / 100 }}
        transition={{ type: 'spring', stiffness: 120, damping: 24 }}
      />
    </div>
  )
}

// Counts to a new number when it changes, so a changed setting visibly changes the estimate.
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const mv = useMotionValue(value)
  const [shown, setShown] = useState(() => format(value))
  useMotionValueEvent(mv, 'change', (v) => setShown(format(v)))
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.35, ease: EASE })
    return () => c.stop()
  }, [mv, value])
  return <span className="tabular-nums">{shown}</span>
}

// Swaps between children with a short crossfade (keyed by `id`).
export function Swap({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <motion.div key={id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: EASE }} className={className}>
      {children}
    </motion.div>
  )
}
