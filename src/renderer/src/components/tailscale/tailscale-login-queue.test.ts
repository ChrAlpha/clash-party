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

  it('replays a cancelled prompt and deduplicates the following log', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)
    expect(queue.closeCurrent(1)).toEqual([])

    expect(queue.replay(request, 2)).toEqual([request])
    expect(queue.record(request, 3)).toEqual([request])
  })

  it('starts a fresh deduplication window when a prompt is cancelled', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)
    queue.closeCurrent(TailscaleLoginQueue.deduplicationTtlMs - 1)

    expect(queue.record(request, TailscaleLoginQueue.deduplicationTtlMs)).toEqual([])
  })

  it('clears requests and deduplication state on a core generation change', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)

    expect(queue.clear()).toEqual([])
    expect(queue.record(request, 1)).toEqual([request])
  })

  it('keeps a prompt recoverable after the user opens it', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)

    expect(queue.openCurrent(1)).toEqual([])
    expect(queue.replay(request, 2)).toEqual([request])
  })
})
