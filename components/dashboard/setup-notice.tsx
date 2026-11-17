import { Check } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { Setup } from './shared'

const ITEMS: { key: keyof Setup; label: string; help: React.ReactNode }[] = [
  { key: 'redis', label: 'Redis', help: <>Vercel → this project → Storage → Create Database → Upstash for Redis (free) → Connect.</> },
  { key: 'blob', label: 'Blob storage', help: <>Connect a Blob store in the Storage tab.</> },
  { key: 'appPassword', label: 'APP_PASSWORD', help: <>The password for this page.</> },
  { key: 'sparkLabToken', label: 'SPARK_LAB_TOKEN', help: <>Your spark-lab-… token from the Spark training page.</> },
  { key: 'workerSecret', label: 'WORKER_SECRET', help: <>A long random string the worker uses to reach this app.</> },
]

export function SetupNotice({ setup }: { setup: Setup }) {
  const left = ITEMS.filter((i) => !setup[i.key])
  if (!left.length) return null
  return (
    <Alert>
      <AlertTitle>Finish Setup ({left.length} left)</AlertTitle>
      <AlertDescription>
        <p>Add these in Vercel, then redeploy (Deployments → ⋯ → Redeploy) so they take effect.</p>
        <ul className="mt-2 grid gap-1.5">
          {ITEMS.map((it) => {
            const ok = setup[it.key]
            return (
              <li key={it.key} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', ok && 'border-primary bg-primary text-primary-foreground')}
                >
                  {ok && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span>
                  <span className="font-mono text-xs text-foreground" translate="no">
                    {it.label}
                  </span>
                  <span className="sr-only">{ok ? ' (done)' : ' (to do)'}</span>
                  {!ok && <span className="block text-xs">{it.help}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
