// Load .env file explicitly before any module reads process.env.
// The Vibecode launcher injects a minimal env (PORT only) and bun's auto
// .env loading doesn't fire — this fills the gap.
import { readFileSync } from 'fs'
import { join } from 'path'

try {
  const content = readFileSync(join(process.cwd(), '.env'), 'utf8')
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key && process.env[key] === undefined) process.env[key] = val
  }
} catch { /* no .env = rely on injected env */ }
