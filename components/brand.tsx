import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// Status shown with text and a filled/hollow dot, never by color alone.
export function StatusBadge({ on, children, className }: { on: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn('h-7 gap-1.5 px-2.5 font-normal', !on && 'text-muted-foreground', className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full border border-current', on && 'bg-current')} />
      {children}
    </Badge>
  )
}
