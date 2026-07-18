import { describe, expect, it } from 'vitest'
import type { TailscaleLogin } from '../../shared/tailscale'
import { TailscaleLoginCache } from './tailscaleLoginCache'

const login = (proxyName: string, suffix = proxyName): TailscaleLogin => ({
  proxyName,
  url: `https://login.example.test/${suffix}`
})

describe('TailscaleLoginCache', () => {
  it('returns recent logins in bounded insertion order', () => {
    const cache = new TailscaleLoginCache(1_000, 2)
    cache.record(login('one'), 0)
    cache.record(login('two'), 1)
    cache.record(login('three'), 2)

    expect(cache.list(3)).toEqual([login('two'), login('three')])
  })

  it('keeps distinct URLs for same-named provider nodes', () => {
    const cache = new TailscaleLoginCache(1_000, 10)
    cache.record(login('shared', 'first'), 0)
    cache.record(login('shared', 'second'), 1)

    expect(cache.list(2)).toEqual([login('shared', 'first'), login('shared', 'second')])
  })

  it('refreshes duplicate entries and expires stale logins', () => {
    const cache = new TailscaleLoginCache(100, 10)
    cache.record(login('one'), 0)
    cache.record(login('two'), 10)
    cache.record(login('one'), 50)

    expect(cache.list(100)).toEqual([login('two'), login('one')])
    expect(cache.list(110)).toEqual([login('one')])
    expect(cache.list(150)).toEqual([])
  })

  it('clears all entries on a core generation change', () => {
    const cache = new TailscaleLoginCache(1_000, 10)
    cache.record(login('one'), 0)

    cache.clear()

    expect(cache.list(1)).toEqual([])
  })
})
