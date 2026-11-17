import { Redis } from '@upstash/redis'
import { HttpError } from './http'

let client: Redis | null | undefined

function findEnv(suffix: string) {
  if (process.env[suffix]) return process.env[suffix]
  // The Vercel Marketplace lets you add a custom prefix (e.g. STORAGE_KV_REST_API_URL).
  const key = Object.keys(process.env).find((k) => k.endsWith(`_${suffix}`))
  return key ? process.env[key] : undefined
}

export function redisConfigured() {
  const url = findEnv('KV_REST_API_URL') || findEnv('UPSTASH_REDIS_REST_URL')
  const token = findEnv('KV_REST_API_TOKEN') || findEnv('UPSTASH_REDIS_REST_TOKEN')
  return url && token ? { url, token } : null
}

export function redis(): Redis {
  if (client) return client
  const cfg = redisConfigured()
  if (!cfg) {
    throw new HttpError(
      503,
      'Redis is not connected. In the Vercel dashboard: this project → Storage → Create Database → Upstash for Redis (free), connect it to the project, then redeploy.',
    )
  }
  client = new Redis({ url: cfg.url, token: cfg.token })
  return client
}
