'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

// A button for async actions: keeps its label, adds a spinner once the wait passes 150 ms
// (so quick actions don't flash), and is disabled only while the request is in flight.
export function PendingButton({
  pending,
  pendingLabel,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean; pendingLabel?: React.ReactNode }) {
  const [showSpinner, setShowSpinner] = useState(false)
  useEffect(() => {
    if (!pending) {
      setShowSpinner(false)
      return
    }
    const t = setTimeout(() => setShowSpinner(true), 150)
    return () => clearTimeout(t)
  }, [pending])
  return (
    <Button {...props} disabled={props.disabled || pending} aria-busy={pending || undefined}>
      {showSpinner && <Spinner aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
