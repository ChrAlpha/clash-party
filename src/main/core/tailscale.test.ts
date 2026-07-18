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

    const addedStateDirs = ensureTailscaleStateDirs(profile)
    expect(addedStateDirs).toHaveLength(2)

    const [home, work, regular] = profile.proxies
    expect(home['state-dir']).toMatch(/^default\/tailscale\/[a-f0-9]{16}$/)
    expect(work['state-dir']).toMatch(/^default\/tailscale\/[a-f0-9]{16}$/)
    expect(home['state-dir']).not.toBe(work['state-dir'])
    expect(addedStateDirs).toEqual([home['state-dir'], work['state-dir']])
    expect(regular).not.toHaveProperty('state-dir')

    const originalDirectories = [home['state-dir'], work['state-dir']]
    expect(ensureTailscaleStateDirs(profile)).toEqual([])
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

    expect(ensureTailscaleStateDirs(profile)).toEqual([])
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

  it('keeps generated state in the same profile directory across work directory modes', () => {
    const sharedWorkDirProfile = {
      proxies: [{ name: 'tailscale', type: 'tailscale' }] as Record<string, unknown>[]
    }
    const separateWorkDirProfile = {
      proxies: [{ name: 'tailscale', type: 'tailscale' }] as Record<string, unknown>[]
    }

    ensureTailscaleStateDirs(sharedWorkDirProfile, 'profile-a', false)
    ensureTailscaleStateDirs(separateWorkDirProfile, 'profile-a', true)

    const sharedStateDir = sharedWorkDirProfile.proxies[0]['state-dir']
    const separateStateDir = separateWorkDirProfile.proxies[0]['state-dir']
    expect(sharedStateDir).toMatch(/^profile-a\/tailscale\/[a-f0-9]{16}$/)
    expect(separateStateDir).toMatch(/^tailscale\/[a-f0-9]{16}$/)
    expect(String(sharedStateDir).replace(/^profile-a\//u, '')).toBe(separateStateDir)
  })

  it('assigns unique state directories to Tailscale proxies in inline providers', () => {
    const directProxy: Record<string, unknown> = { name: 'home', type: 'tailscale' }
    const inlineProxy: Record<string, unknown> = { name: 'home', type: 'tailscale' }
    const profile = {
      proxies: [directProxy],
      'proxy-providers': {
        embedded: {
          type: 'inline',
          payload: [inlineProxy, { name: 'regular', type: 'ss' }]
        },
        remote: {
          type: 'http',
          payload: [{ name: 'ignored', type: 'tailscale' }]
        }
      }
    }

    expect(ensureTailscaleStateDirs(profile, 'profile-a')).toHaveLength(2)
    expect(directProxy['state-dir']).toMatch(/^profile-a\/tailscale\/[a-f0-9]{16}$/)
    expect(inlineProxy['state-dir']).toMatch(/^profile-a\/tailscale\/[a-f0-9]{16}$/)
    expect(directProxy['state-dir']).not.toBe(inlineProxy['state-dir'])
    expect(profile['proxy-providers'].remote.payload[0]).not.toHaveProperty('state-dir')
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

  it('reports auth keys in inline Tailscale providers', () => {
    expect(
      containsTailscaleAuthKey({
        'proxy-providers': {
          embedded: {
            type: 'inline',
            payload: [{ name: 'tailnet', type: 'tailscale', 'auth-key': 'credential-value' }]
          }
        }
      })
    ).toBe(true)
  })
})

describe('extractTailscaleLogin', () => {
  it('extracts an interactive login URL and proxy name', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://login.tailscale.com/a/abc123.'
      )
    ).toEqual({
      proxyName: 'home',
      url: 'https://login.tailscale.com/a/abc123'
    })
  })

  it('supports custom Headscale authentication URLs', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](work) To start this tsnet server, restart with TS_AUTHKEY set, or go to: http://headscale.example.test/register/node-key'
      )
    ).toEqual({
      proxyName: 'work',
      url: 'http://headscale.example.test/register/node-key'
    })
  })

  it('selects the first valid login prompt from independent log lines', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) connected to https://login.example.test/ordinary-status\r\n[Tailscale](work) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://headscale.example.test/register/node-key\r\n[Tailscale](other) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://login.tailscale.com/a/other'
      )
    ).toEqual({
      proxyName: 'work',
      url: 'https://headscale.example.test/register/node-key'
    })
  })

  it('does not infer login intent from the URL itself', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) connected to https://login.example.test/ordinary-status'
      )
    ).toBeUndefined()
  })

  it('does not combine a Tailscale marker with a URL from another log line', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) To start this tsnet server, restart with TS_AUTHKEY set, or go to:\n[HTTP](other) https://example.test/login'
      )
    ).toBeUndefined()
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
        '[Tailscale](home) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://user:password@example.test/login'
      )
    ).toBeUndefined()
  })
})
