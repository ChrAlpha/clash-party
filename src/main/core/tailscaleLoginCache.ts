import type { TailscaleLogin } from '../../shared/tailscale'

interface CachedLogin {
  login: TailscaleLogin
  seenAt: number
}

function loginKey(login: TailscaleLogin): string {
  return `${login.proxyName}\0${login.url}`
}

export class TailscaleLoginCache {
  private readonly entries = new Map<string, CachedLogin>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  record(login: TailscaleLogin, now = Date.now()): void {
    this.prune(now)
    const key = loginKey(login)
    this.entries.delete(key)
    this.entries.set(key, { login: { ...login }, seenAt: now })
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) return
      this.entries.delete(oldestKey)
    }
  }

  list(now = Date.now()): TailscaleLogin[] {
    this.prune(now)
    return [...this.entries.values()].map(({ login }) => ({ ...login }))
  }

  clear(): void {
    this.entries.clear()
  }

  private prune(now: number): void {
    this.entries.forEach(({ seenAt }, key) => {
      if (now - seenAt >= this.ttlMs) this.entries.delete(key)
    })
  }
}
