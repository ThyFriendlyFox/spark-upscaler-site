'use client'

import { MotionConfig } from 'motion/react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

// reducedMotion="user": animations collapse to instant changes for people who ask their OS for less motion.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
      <TooltipProvider delayDuration={400} skipDelayDuration={200}>
        {children}
        <Toaster theme="system" position="bottom-center" />
      </TooltipProvider>
    </MotionConfig>
  )
}
