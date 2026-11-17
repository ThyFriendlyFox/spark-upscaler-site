'use client'

import { useEffect, useId, useState } from 'react'
import { Reveal } from '@/components/motion'
import { PendingButton } from '@/components/pending-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export default function Login() {
  const id = useId()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null)
  const [desktop, setDesktop] = useState(false)

  useEffect(() => {
    // Autofocus only with a mouse; on phones it pops the keyboard and shifts the layout.
    setDesktop(window.matchMedia('(pointer: fine)').matches)
    fetch('/api/login')
      .then((r) => r.json())
      .then((d) => setPasswordSet(!!d.passwordSet))
      .catch(() => setPasswordSet(null))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return setError('Enter the password.')
    setBusy(true)
    setError('')
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setBusy(false)
    if (r.ok) window.location.href = '/'
    else setError((await r.json().catch(() => ({}))).error ?? 'Sign-in failed. Try again.')
  }

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <Reveal className="w-full max-w-sm">
        <Card className="rounded-xl shadow-card ring-1 ring-border">
          <CardHeader>
            <CardTitle>
              <h1 className="text-lg font-semibold tracking-tight">Spark Upscaler</h1>
            </CardTitle>
            <CardDescription>Sign in to queue upscales on the Spark.</CardDescription>
          </CardHeader>
          <CardContent>
            {passwordSet === false ? (
              <p className="text-sm">
                No password is set yet. Add an <code className="font-mono" translate="no">APP_PASSWORD</code> environment variable in Vercel, then redeploy.
              </p>
            ) : (
              <form onSubmit={submit} noValidate>
                <FieldGroup>
                  <Field data-invalid={!!error || undefined}>
                    <FieldLabel htmlFor={`${id}-pw`}>Password</FieldLabel>
                    <Input
                      id={`${id}-pw`}
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      autoFocus={desktop}
                      className="h-9"
                      aria-invalid={!!error || undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    {error && <FieldError role="alert">{error}</FieldError>}
                  </Field>
                  <PendingButton type="submit" className="h-9" pending={busy} pendingLabel="Signing In…">
                    Sign In
                  </PendingButton>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </Reveal>
    </main>
  )
}
