import { describe, expect, it } from 'vitest'
import type { TailscaleLogin } from '../../../../shared/tailscale'
import { TailscaleLoginQueue } from './tailscale-login-queue'

const login = (proxyName: string): TailscaleLogin => ({
  proxyName,
  url: `https://login.example.test/${proxyName}`
})

describe('TailscaleLoginQueue', () => {
  it('keeps the current prompt stable when the normal queue is full', () => {
    const queue = new TailscaleLoginQueue()
    const requests = ['one', 'two', 'three', 'four', 'five', 'six'].reduce(
      (_requests, proxyName) => queue.record(login(proxyName), 0),
      [] as TailscaleLogin[]
    )

    expect(requests.map(({ proxyName }) => proxyName)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five'
    ])
  })

  it('prioritizes a cached explicit retry without replacing the current prompt', () => {
    const queue = new TailscaleLoginQueue()
    for (const proxyName of ['one', 'two', 'three', 'four', 'five', 'six']) {
      queue.record(login(proxyName), 0)
    }

    const requests = queue.replay(login('six'), 1)

    expect(requests.map(({ proxyName }) => proxyName)).toEqual([
      'one',
      'six',
      'two',
      'three',
      'four'
    ])
  })

  it('clears the deduplication mark of an entry bumped off a full queue by replay', () => {
    const queue = new TailscaleLoginQueue()
    for (const proxyName of ['one', 'two', 'three', 'four', 'five']) {
      queue.record(login(proxyName), 0)
    }

    // 'five' is bumped off the tail here and was never actually shown to the user.
    queue.replay(login('six'), 1)

    // Free up the queue without ever recording 'five' again.
    queue.closeCurrent(2) // removes 'one'
    queue.closeCurrent(3) // removes 'six'
    queue.closeCurrent(4) // removes 'two'
    queue.closeCurrent(5) // removes 'three'
    queue.closeCurrent(6) // removes 'four'

    // Still well within the 5-minute deduplication window relative to when 'five' was first
    // recorded at t=0 - if its prompted-at mark had not been cleared it would still be
    // suppressed here.
    expect(queue.record(login('five'), 7)).toEqual([login('five')])
  })

  it('replays a cancelled prompt and deduplicates the following log', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)
    expect(queue.closeCurrent(1)).toEqual([])

    expect(queue.replay(request, 2)).toEqual([request])
    expect(queue.record(request, 3)).toEqual([request])
  })

  it('suppresses a dismissed login from passive record() far beyond the old TTL window', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)
    queue.closeCurrent(TailscaleLoginQueue.deduplicationTtlMs - 1)

    // A cancelled login must stay suppressed for the rest of the session, not just for the
    // 5-minute deduplication window - tsnet keeps re-logging the same pending login every ~5s,
    // and the user already said "not now".
    expect(queue.record(request, TailscaleLoginQueue.deduplicationTtlMs * 100)).toEqual([])
  })

  it('shows a dismissed login again after an explicit replay', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)
    queue.closeCurrent(1)

    // Long after dismissal, a passive record() is still suppressed...
    expect(queue.record(request, TailscaleLoginQueue.deduplicationTtlMs * 100)).toEqual([])

    // ...but an explicit "Initialize" click always overrides the suppression.
    expect(queue.replay(request, TailscaleLoginQueue.deduplicationTtlMs * 100 + 1)).toEqual([
      request
    ])
  })

  it('bounds dismissed login history', () => {
    const queue = new TailscaleLoginQueue()
    for (let index = 0; index <= 100; index += 1) {
      queue.record(login(`node-${index}`), index * 2)
      queue.closeCurrent(index * 2 + 1)
    }

    expect(queue.record(login('node-0'), 1_000)).toEqual([login('node-0')])
  })

  it('clears requests and deduplication state on a core generation change', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)

    expect(queue.clear()).toEqual([])
    expect(queue.record(request, 1)).toEqual([request])
  })

  it('clears dismissal state on a core generation change', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)
    queue.closeCurrent(1)

    queue.clear()

    expect(queue.record(request, 2)).toEqual([request])
  })

  it('keeps a prompt recoverable via replay after the user dismisses it', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)

    expect(queue.closeCurrent(1)).toEqual([])
    expect(queue.replay(request, 2)).toEqual([request])
  })
})
