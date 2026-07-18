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

    const requests = queue.replay('six', 1)

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

    expect(queue.replay('home', 2)).toEqual([request])
    expect(queue.record(request, 3)).toEqual([request])
  })

  it('starts a fresh deduplication window when a prompt is cancelled', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)
    queue.closeCurrent(TailscaleLoginQueue.cacheTtlMs - 1)

    expect(queue.record(request, TailscaleLoginQueue.cacheTtlMs)).toEqual([])
  })

  it('does not replay an expired prompt', () => {
    const queue = new TailscaleLoginQueue()
    queue.record(login('home'), 0)
    queue.closeCurrent(1)

    expect(queue.replay('home', TailscaleLoginQueue.cacheTtlMs)).toEqual([])
  })

  it('forgets a prompt after the user opens it', () => {
    const queue = new TailscaleLoginQueue()
    const request = login('home')
    queue.record(request, 0)

    expect(queue.openCurrent(1)).toEqual([])
    expect(queue.replay('home', 2)).toEqual([])
  })
})
