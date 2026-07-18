import type { TailscaleLogin } from '../../../../shared/tailscale'

interface RecentLogin {
  login: TailscaleLogin
  seenAt: number
}

const MAX_REQUESTS = 5
const MAX_CACHE_ENTRIES = 100

function loginKey(login: TailscaleLogin): string {
  return `${login.proxyName}\0${login.url}`
}

function sameLogin(first: TailscaleLogin, second: TailscaleLogin): boolean {
  return first.proxyName === second.proxyName && first.url === second.url
}

export class TailscaleLoginQueue {
  static readonly cacheTtlMs = 5 * 60 * 1000

  private readonly lastPromptedAt = new Map<string, number>()
  private readonly recentLoginsByProxy = new Map<string, RecentLogin>()
  private requests: TailscaleLogin[] = []

  record(login: TailscaleLogin, now = Date.now()): TailscaleLogin[] {
    this.rememberRecent(login, now)
    const key = loginKey(login)
    this.pruneLastPrompted(now)
    if (now - (this.lastPromptedAt.get(key) ?? -Infinity) < TailscaleLoginQueue.cacheTtlMs) {
      return this.snapshot()
    }
    if (this.requests.some((request) => sameLogin(request, login))) return this.snapshot()
    if (this.requests.length >= MAX_REQUESTS) return this.snapshot()

    this.requests = [...this.requests, login]
    this.rememberPrompted(key, now)
    return this.snapshot()
  }

  replay(proxyName: string, now = Date.now()): TailscaleLogin[] {
    this.pruneRecent(now)
    const recent = this.recentLoginsByProxy.get(proxyName)
    if (!recent) return this.snapshot()

    const key = loginKey(recent.login)
    this.rememberPrompted(key, now)
    if (this.requests.some((request) => sameLogin(request, recent.login))) {
      return this.snapshot()
    }

    this.requests =
      this.requests.length >= MAX_REQUESTS
        ? [this.requests[0], recent.login, ...this.requests.slice(1, MAX_REQUESTS - 1)]
        : [...this.requests, recent.login]
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

  private rememberRecent(login: TailscaleLogin, now: number): void {
    this.pruneRecent(now)
    this.recentLoginsByProxy.delete(login.proxyName)
    this.recentLoginsByProxy.set(login.proxyName, { login, seenAt: now })
    this.trimMap(this.recentLoginsByProxy)
  }

  private pruneRecent(now: number): void {
    this.recentLoginsByProxy.forEach(({ seenAt }, proxyName) => {
      if (now - seenAt >= TailscaleLoginQueue.cacheTtlMs) {
        this.recentLoginsByProxy.delete(proxyName)
      }
    })
  }

  private pruneLastPrompted(now: number): void {
    this.lastPromptedAt.forEach((promptedAt, key) => {
      if (now - promptedAt >= TailscaleLoginQueue.cacheTtlMs) {
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
