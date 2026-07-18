import { describe, expect, it } from 'vitest'
import { extractTailscaleLogin } from '../../shared/tailscale'
import { containsTailscaleAuthKey, ensureTailscaleStateDirs } from './tailscale'

describe('ensureTailscaleStateDirs', () => {
  it('assigns a stable unique state directory to each Tailscale proxy', () => {
    const proxies: Record<string, unknown>[] = [
      { name: 'home', type: 'tailscale', udp: true },
      { name: 'work', type: 'tailscale', 'accept-routes': false },
      { name: 'regular', type: 'ss', server: 'example.com' }
    ]
    const profile = { proxies }

    expect(ensureTailscaleStateDirs(profile)).toBe(2)

    const [home, work, regular] = profile.proxies
    expect(home['state-dir']).toMatch(/^tailscale\/[a-f0-9]{16}$/)
    expect(work['state-dir']).toMatch(/^tailscale\/[a-f0-9]{16}$/)
    expect(home['state-dir']).not.toBe(work['state-dir'])
    expect(regular).not.toHaveProperty('state-dir')

    const originalDirectories = [home['state-dir'], work['state-dir']]
    expect(ensureTailscaleStateDirs(profile)).toBe(0)
    expect([home['state-dir'], work['state-dir']]).toEqual(originalDirectories)
  })

  it('preserves explicit directories, optional false values, and future fields', () => {
    const proxy = {
      name: 'tailnet',
      type: 'tailscale',
      'state-dir': './custom-state',
      'accept-routes': false,
      'exit-node-allow-lan-access': false,
      'future-option': { enabled: true }
    }
    const profile = { proxies: [proxy] }

    expect(ensureTailscaleStateDirs(profile)).toBe(0)
    expect(proxy).toEqual({
      name: 'tailnet',
      type: 'tailscale',
      'state-dir': './custom-state',
      'accept-routes': false,
      'exit-node-allow-lan-access': false,
      'future-option': { enabled: true }
    })
  })

  it('does not share an implicit identity between profiles with the same proxy name', () => {
    const first = {
      proxies: [{ name: 'tailscale', type: 'tailscale' }] as Record<string, unknown>[]
    }
    const second = {
      proxies: [{ name: 'tailscale', type: 'tailscale' }] as Record<string, unknown>[]
    }

    ensureTailscaleStateDirs(first, 'profile-a')
    ensureTailscaleStateDirs(second, 'profile-b')

    expect(first.proxies[0]['state-dir']).not.toBe(second.proxies[0]['state-dir'])
  })
})

describe('containsTailscaleAuthKey', () => {
  it('only reports non-empty auth keys on Tailscale proxies', () => {
    expect(
      containsTailscaleAuthKey({
        proxies: [
          { name: 'empty', type: 'tailscale', 'auth-key': '  ' },
          { name: 'other', type: 'http', 'auth-key': 'not-a-tailscale-key' }
        ]
      })
    ).toBe(false)

    expect(
      containsTailscaleAuthKey({
        proxies: [{ name: 'tailnet', type: 'tailscale', 'auth-key': 'credential-value' }]
      })
    ).toBe(true)
  })
})

describe('extractTailscaleLogin', () => {
  it('extracts an interactive login URL and proxy name', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) To authenticate, visit: https://login.tailscale.com/a/abc123.'
      )
    ).toEqual({
      proxyName: 'home',
      url: 'https://login.tailscale.com/a/abc123'
    })
  })

  it('supports custom Headscale authentication URLs', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](work) Please visit http://headscale.example.test/register/node-key to log in'
      )
    ).toEqual({
      proxyName: 'work',
      url: 'http://headscale.example.test/register/node-key'
    })
  })

  it('ignores unrelated URLs, other loggers, and credential-bearing URLs', () => {
    expect(
      extractTailscaleLogin('[Tailscale](home) connected to https://derp.example.test')
    ).toBeUndefined()
    expect(
      extractTailscaleLogin('[HTTP](home) To authenticate, visit: https://example.test/login')
    ).toBeUndefined()
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) To authenticate, visit: https://user:password@example.test/login'
      )
    ).toBeUndefined()
  })
})
