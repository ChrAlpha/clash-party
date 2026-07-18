export interface ProviderProxyLookup {
  proxiesByProvider: Map<string, Map<string, IMihomoProxy>>
  resolvedProviders: Set<string>
}

export interface ProviderGroupSourceConfig {
  use?: string[]
  proxies?: string[]
  'include-all'?: boolean
  'include-all-proxies'?: boolean
  'include-all-providers'?: boolean
}

export interface ProviderGroupSources {
  providerNames: string[] | undefined
  directProxyNames: Set<string> | undefined
}

type ProviderProxyResolution =
  | { status: 'none' }
  | { status: 'resolved'; proxy: IMihomoProxy }
  | { status: 'ambiguous' | 'unknown' }

export function groupProxySources(group: ProviderGroupSourceConfig): ProviderGroupSources {
  const includesAllProxies = group['include-all'] === true || group['include-all-proxies'] === true
  const includesAllProviders =
    group['include-all'] === true || group['include-all-providers'] === true
  return {
    providerNames: includesAllProviders ? undefined : [...(group.use ?? [])],
    directProxyNames: includesAllProxies ? undefined : new Set(group.proxies ?? [])
  }
}

export function indexProviderProxies(
  providers: IMihomoProxyProvider[],
  names: ReadonlySet<string>,
  resolvedProviderNames?: ReadonlySet<string>
): ProviderProxyLookup {
  const proxiesByProvider = new Map<string, Map<string, IMihomoProxy>>()

  for (const provider of providers) {
    const proxiesByName = new Map<string, IMihomoProxy>()
    for (const proxy of provider.proxies ?? []) {
      if (!names.has(proxy.name)) continue
      proxiesByName.set(proxy.name, { ...proxy, 'provider-name': provider.name })
    }
    proxiesByProvider.set(provider.name, proxiesByName)
  }

  return {
    proxiesByProvider,
    resolvedProviders: new Set(resolvedProviderNames ?? providers.map((provider) => provider.name))
  }
}

function resolveProviderProxy(
  lookup: ProviderProxyLookup,
  name: string,
  providerNames: readonly string[] | undefined
): ProviderProxyResolution {
  const candidates =
    providerNames === undefined ? new Set(lookup.proxiesByProvider.keys()) : new Set(providerNames)
  if ([...candidates].some((providerName) => !lookup.resolvedProviders.has(providerName))) {
    return { status: 'unknown' }
  }

  let resolved: IMihomoProxy | undefined
  for (const providerName of candidates) {
    const candidate = lookup.proxiesByProvider.get(providerName)?.get(name)
    if (!candidate) continue
    if (resolved) return { status: 'ambiguous' }
    resolved = candidate
  }

  return resolved ? { status: 'resolved', proxy: resolved } : { status: 'none' }
}

export function resolveGroupProxy(
  directProxy: IMihomoProxy | IMihomoGroup | undefined,
  lookup: ProviderProxyLookup,
  name: string,
  providerNames: readonly string[] | undefined,
  directProxyNames: ReadonlySet<string> | undefined
): IMihomoProxy | IMihomoGroup | undefined {
  const directCandidate =
    directProxyNames === undefined || directProxyNames.has(name) ? directProxy : undefined
  if (providerNames?.length === 0) return directCandidate

  const providerResolution = resolveProviderProxy(lookup, name, providerNames)
  if (providerResolution.status === 'none') return directCandidate
  if (providerResolution.status !== 'resolved' || directCandidate) return undefined
  return providerResolution.proxy
}
