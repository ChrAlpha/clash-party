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
  // Logins the user explicitly cancelled/closed. A dismissed login is skipped by
  // passive record() calls (fresh log lines keep re-reporting the same pending login every ~5s)
  // for the rest of the session, not just for the deduplicationTtlMs window - the user already
  // said "not now" and re-popping the same modal every few minutes forever is the bug being
  // fixed here. An explicit replay() (user clicks "Initialize" again) always clears the
  // suppression, since that is an unambiguous request to see it again.
  private readonly dismissed = new Set<string>()
  private requests: TailscaleLogin[] = []

  record(login: TailscaleLogin, now = Date.now()): TailscaleLogin[] {
    const key = loginKey(login)
    if (this.dismissed.has(key)) return this.snapshot()
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
    this.dismissed.delete(key)
    this.rememberPrompted(key, now)
    if (this.requests.some((request) => sameLogin(request, login))) {
      return this.snapshot()
    }

    const [current, ...remaining] = this.requests
    const merged = current ? [current, login, ...remaining] : [login]
    const dropped = merged.slice(MAX_REQUESTS)
    this.requests = merged.slice(0, MAX_REQUESTS)
    // The entry bumped off the tail was never actually shown to the user, so its prompted-at
    // mark must not linger and block it from being re-recorded for the next 5 minutes.
    dropped.forEach((entry) => this.lastPromptedAt.delete(loginKey(entry)))
    return this.snapshot()
  }

  clear(): TailscaleLogin[] {
    this.requests = []
    this.lastPromptedAt.clear()
    this.dismissed.clear()
    return this.snapshot()
  }

  closeCurrent(now = Date.now()): TailscaleLogin[] {
    const current = this.requests[0]
    if (current) {
      const key = loginKey(current)
      this.rememberPrompted(key, now)
      this.rememberDismissed(key)
    }
    this.requests = this.requests.slice(1)
    return this.snapshot()
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

  private rememberDismissed(key: string): void {
    this.dismissed.delete(key)
    this.dismissed.add(key)
    while (this.dismissed.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.dismissed.values().next().value
      if (oldestKey === undefined) return
      this.dismissed.delete(oldestKey)
    }
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
