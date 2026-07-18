import type { TailscaleLogin } from '../../../../shared/tailscale'

const MAX_REQUESTS = 5
const MAX_CACHE_ENTRIES = 100

function loginKey(login: TailscaleLogin): string {
  return `${login.proxyName}\0${login.url}`
}

function sameLogin(first: TailscaleLogin, second: TailscaleLogin): boolean {
  return first.proxyName === second.proxyName && first.url === second.url
}

export class TailscaleLoginQueue {
  static readonly deduplicationTtlMs = 5 * 60 * 1000

  private readonly lastPromptedAt = new Map<string, number>()
  private requests: TailscaleLogin[] = []

  record(login: TailscaleLogin, now = Date.now()): TailscaleLogin[] {
    const key = loginKey(login)
    this.pruneLastPrompted(now)
    if (
      now - (this.lastPromptedAt.get(key) ?? -Infinity) <
      TailscaleLoginQueue.deduplicationTtlMs
    ) {
      return this.snapshot()
    }
    if (this.requests.some((request) => sameLogin(request, login))) return this.snapshot()
    if (this.requests.length >= MAX_REQUESTS) return this.snapshot()

    this.requests = [...this.requests, login]
    this.rememberPrompted(key, now)
    return this.snapshot()
  }

  replay(login: TailscaleLogin, now = Date.now()): TailscaleLogin[] {
    const key = loginKey(login)
    this.rememberPrompted(key, now)
    if (this.requests.some((request) => sameLogin(request, login))) {
      return this.snapshot()
    }

    const [current, ...remaining] = this.requests
    this.requests = current ? [current, login, ...remaining].slice(0, MAX_REQUESTS) : [login]
    return this.snapshot()
  }

  clear(): TailscaleLogin[] {
    this.requests = []
    this.lastPromptedAt.clear()
    return this.snapshot()
  }

  closeCurrent(now = Date.now()): TailscaleLogin[] {
    const current = this.requests[0]
    if (current) this.rememberPrompted(loginKey(current), now)
    this.requests = this.requests.slice(1)
    return this.snapshot()
  }

  openCurrent(now = Date.now()): TailscaleLogin[] {
    return this.closeCurrent(now)
  }

  private pruneLastPrompted(now: number): void {
    this.lastPromptedAt.forEach((promptedAt, key) => {
      if (now - promptedAt >= TailscaleLoginQueue.deduplicationTtlMs) {
        this.lastPromptedAt.delete(key)
      }
    })
  }

  private rememberPrompted(key: string, now: number): void {
    this.lastPromptedAt.delete(key)
    this.lastPromptedAt.set(key, now)
    this.trimMap(this.lastPromptedAt)
  }

  private trimMap<Value>(map: Map<string, Value>): void {
    while (map.size > MAX_CACHE_ENTRIES) {
      const oldestKey = map.keys().next().value
      if (oldestKey === undefined) return
      map.delete(oldestKey)
    }
  }

  private snapshot(): TailscaleLogin[] {
    return [...this.requests]
  }
}
