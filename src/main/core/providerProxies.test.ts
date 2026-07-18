import { describe, expect, it } from 'vitest'
import { groupProxySources, indexProviderProxies, resolveGroupProxy } from './providerProxies'

function proxy(name: string): IMihomoProxy {
  return { name, type: 'Tailscale' } as IMihomoProxy
}

function provider(name: string, proxies: IMihomoProxy[]): IMihomoProxyProvider {
  return { name, proxies } as IMihomoProxyProvider
}

describe('provider proxy resolver', () => {
  it('classifies explicit and include-all group sources', () => {
    const providerOnly = groupProxySources({
      proxies: ['direct'],
      use: ['selected-provider'],
      'include-all-providers': true
    })
    expect(providerOnly.providerNames).toBeUndefined()
    expect(providerOnly.directProxyNames).toEqual(new Set(['direct']))

    expect(groupProxySources({ 'include-all': true })).toEqual({
      providerNames: undefined,
      directProxyNames: undefined
    })
  })

  it('keeps same-named proxies scoped to their provider', () => {
    const direct = proxy('shared')
    const lookup = indexProviderProxies(
      [provider('provider-a', [proxy('shared')]), provider('provider-b', [proxy('shared')])],
      new Set(['shared'])
    )

    expect(resolveGroupProxy(direct, lookup, 'shared', ['provider-a'], new Set())).toMatchObject({
      name: 'shared',
      'provider-name': 'provider-a'
    })
    expect(resolveGroupProxy(direct, lookup, 'shared', ['provider-b'], new Set())).toMatchObject({
      name: 'shared',
      'provider-name': 'provider-b'
    })
  })

  it('fails closed when an explicit proxy conflicts with a provider proxy', () => {
    const direct = proxy('shared')
    const lookup = indexProviderProxies(
      [provider('provider-a', [proxy('shared')])],
      new Set(['shared'])
    )

    expect(
      resolveGroupProxy(direct, lookup, 'shared', ['provider-a'], new Set(['shared']))
    ).toBeUndefined()
  })

  it('fails closed when fallback lookup finds an ambiguous name', () => {
    const lookup = indexProviderProxies(
      [provider('provider-a', [proxy('shared')]), provider('provider-b', [proxy('shared')])],
      new Set(['shared'])
    )

    expect(resolveGroupProxy(undefined, lookup, 'shared', undefined, undefined)).toBeUndefined()
  })

  it('filters unused names and stamps a unique fallback with its provider', () => {
    const lookup = indexProviderProxies(
      [provider('provider-a', [proxy('used'), proxy('unused')])],
      new Set(['used'])
    )

    expect(resolveGroupProxy(undefined, lookup, 'used', undefined, new Set())).toMatchObject({
      name: 'used',
      'provider-name': 'provider-a'
    })
    expect(
      resolveGroupProxy(undefined, lookup, 'unused', ['provider-a'], new Set())
    ).toBeUndefined()
  })

  it('fails closed when any candidate provider could not be resolved', () => {
    const lookup = indexProviderProxies(
      [provider('provider-b', [proxy('shared')])],
      new Set(['shared']),
      new Set(['provider-b'])
    )

    expect(
      resolveGroupProxy(undefined, lookup, 'shared', ['provider-a', 'provider-b'], new Set())
    ).toBeUndefined()
  })

  it('resolves include-all-providers nodes without an explicit use list', () => {
    const lookup = indexProviderProxies(
      [provider('provider-a', [proxy('included')])],
      new Set(['included'])
    )

    expect(
      resolveGroupProxy(proxy('included'), lookup, 'included', undefined, new Set())
    ).toMatchObject({
      name: 'included',
      'provider-name': 'provider-a'
    })
  })

  it('fails closed on include-all direct and provider name collisions', () => {
    const lookup = indexProviderProxies(
      [provider('provider-a', [proxy('shared')])],
      new Set(['shared'])
    )

    expect(
      resolveGroupProxy(proxy('shared'), lookup, 'shared', undefined, undefined)
    ).toBeUndefined()
  })
})
