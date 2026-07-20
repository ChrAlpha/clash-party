import { describe, expect, it } from 'vitest'
import {
  containsTailscaleAuthKey,
  ensureTailscaleStateDirs,
  findUnverifiedProviderTailscaleProxies
} from './tailscale'

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

  // `.trim()`-ing the name before hashing collided two distinct mihomo proxies
  // (which are disambiguated by their raw, untrimmed name) onto a single tsnet identity.
  it('does not collide state directories for proxy names that differ only by surrounding whitespace', () => {
    const bare: Record<string, unknown> = { name: 'home', type: 'tailscale' }
    const padded: Record<string, unknown> = { name: '  home  ', type: 'tailscale' }
    const profile = { proxies: [bare, padded] }

    const added = ensureTailscaleStateDirs(profile)
    expect(added).toHaveLength(2)
    expect(bare['state-dir']).not.toBe(padded['state-dir'])
  })

  it('de-duplicates state directories for proxies that share an identical name in one scope', () => {
    const first: Record<string, unknown> = { name: 'dup', type: 'tailscale' }
    const second: Record<string, unknown> = { name: 'dup', type: 'tailscale' }
    const profile = { proxies: [first, second] }

    const added = ensureTailscaleStateDirs(profile)
    expect(added).toHaveLength(2)
    expect(new Set(added).size).toBe(2)
    expect(first['state-dir']).not.toBe(second['state-dir'])
  })

  it('only falls back to the shared unnamed identity for genuinely empty names, and still de-duplicates it', () => {
    const missingName: Record<string, unknown> = { type: 'tailscale' }
    const emptyName: Record<string, unknown> = { name: '', type: 'tailscale' }
    const whitespaceName: Record<string, unknown> = { name: '   ', type: 'tailscale' }
    const profile = { proxies: [missingName, emptyName, whitespaceName] }

    const added = ensureTailscaleStateDirs(profile)
    expect(added).toHaveLength(3)
    // Every generated directory must be unique - no two proxies in the same scope collide.
    expect(new Set(added).size).toBe(3)
    // A whitespace-only name is not "genuinely empty": it hashes on its own raw value and must
    // not share the 'unnamed' fallback used by the missing/empty-string proxies.
    expect(whitespaceName['state-dir']).not.toBe(missingName['state-dir'])
    expect(whitespaceName['state-dir']).not.toBe(emptyName['state-dir'])
  })
})

describe('findUnverifiedProviderTailscaleProxies', () => {
  it('flags Tailscale proxies sourced from HTTP/File providers', () => {
    const found = findUnverifiedProviderTailscaleProxies({
      remote: {
        vehicleType: 'HTTP',
        proxies: [
          { name: 'home', type: 'Tailscale' },
          { name: 'plain', type: 'Shadowsocks' }
        ]
      },
      local: {
        vehicleType: 'File',
        proxies: [{ name: 'work', type: 'Tailscale' }]
      }
    })

    expect(found).toEqual(
      expect.arrayContaining([
        { providerName: 'remote', proxyName: 'home' },
        { providerName: 'local', proxyName: 'work' }
      ])
    )
    expect(found).toHaveLength(2)
  })

  it('ignores inline providers (the app already injects their state-dir) and synthetic Compatible providers', () => {
    const found = findUnverifiedProviderTailscaleProxies({
      inline: {
        vehicleType: 'Inline',
        proxies: [{ name: 'inline-node', type: 'Tailscale' }]
      },
      default: {
        vehicleType: 'Compatible',
        proxies: [{ name: 'inline-node', type: 'Tailscale' }]
      }
    })

    expect(found).toEqual([])
  })

  it('returns an empty list when there are no unverified Tailscale proxies', () => {
    expect(
      findUnverifiedProviderTailscaleProxies({
        remote: { vehicleType: 'HTTP', proxies: [{ name: 'ss', type: 'Shadowsocks' }] }
      })
    ).toEqual([])
    expect(findUnverifiedProviderTailscaleProxies({})).toEqual([])
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

  // An http/file provider's payload is normally fetched by the core at runtime and
  // never seen by the app - but if a profile YAML still carries a leftover `payload` array on
  // such a provider, that array is serialized into the uploaded/backed-up config text just like
  // any other field, so the auth-key guard must not skip it just because the provider is not
  // `inline`.
  it('reports auth keys left over in a non-inline (http/file) provider payload', () => {
    expect(
      containsTailscaleAuthKey({
        'proxy-providers': {
          remote: {
            type: 'http',
            payload: [{ name: 'tailnet', type: 'tailscale', 'auth-key': 'credential-value' }]
          }
        }
      })
    ).toBe(true)

    expect(
      containsTailscaleAuthKey({
        'proxy-providers': {
          local: {
            type: 'file',
            payload: [{ name: 'tailnet', type: 'tailscale', 'auth-key': 'credential-value' }]
          }
        }
      })
    ).toBe(true)
  })

  it('reports auth keys nested in an override-style patch', () => {
    expect(
      containsTailscaleAuthKey({
        patch: {
          'append-proxies': [{ name: 'tailnet', type: 'tailscale', 'auth-key': 'credential-value' }]
        }
      })
    ).toBe(true)
  })
})
