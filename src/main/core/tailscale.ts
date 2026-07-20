import { createHash } from 'crypto'

type MihomoProxyConfig = Record<string, unknown>
type MihomoProfile = { proxies?: unknown; 'proxy-providers'?: unknown }

interface ScopedTailscaleProxy {
  proxy: MihomoProxyConfig
  scope: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTailscaleProxy(value: unknown): value is MihomoProxyConfig {
  return isRecord(value) && String(value.type).toLowerCase() === 'tailscale'
}

function tailscaleProxiesInScope(value: unknown, scope: string): ScopedTailscaleProxy[] {
  if (!Array.isArray(value)) return []
  return value.filter(isTailscaleProxy).map((proxy) => ({ proxy, scope }))
}

function tailscaleProxies(profile: MihomoProfile): ScopedTailscaleProxy[] {
  const proxies = tailscaleProxiesInScope(profile.proxies, 'proxies')
  if (!isRecord(profile['proxy-providers'])) return proxies

  Object.entries(profile['proxy-providers']).forEach(([providerName, provider]) => {
    if (!isRecord(provider) || String(provider.type).toLowerCase() !== 'inline') return
    proxies.push(...tailscaleProxiesInScope(provider.payload, `proxy-providers\0${providerName}`))
  })
  return proxies
}

function stateDirectoryForProxy(
  seed: string,
  profileId: string,
  scope: string,
  diffWorkDir: boolean
): string {
  const id = createHash('sha256')
    .update(profileId)
    .update('\0')
    .update(scope)
    .update('\0')
    .update(seed)
    .digest('hex')
    .slice(0, 16)
  const profileDirectory = diffWorkDir ? '' : `${profileId}/`
  return `${profileDirectory}tailscale/${id}`
}

export function ensureTailscaleStateDirs(
  profile: MihomoProfile,
  profileId = 'default',
  diffWorkDir = false
): string[] {
  const added: string[] = []
  // Tracks every directory handed out in this call so two proxies in the same scope can never be
  // assigned the same identity, even if their raw names happen to collide.
  const assignedStateDirs = new Set<string>()

  tailscaleProxies(profile).forEach(({ proxy, scope }) => {
    const existingStateDir = proxy['state-dir']
    if (typeof existingStateDir === 'string' && existingStateDir.trim()) return

    // Hash the RAW name (not `.trim()`-ed): mihomo treats "home" and " home " as distinct
    // proxies, so trimming would collide two different proxies onto one tsnet identity. Only
    // genuinely empty/missing names fall back to the 'unnamed' seed.
    const rawName = typeof proxy.name === 'string' ? proxy.name : ''
    const stableName = rawName.length > 0 ? rawName : 'unnamed'

    let seed = stableName
    let stateDir = stateDirectoryForProxy(seed, profileId, scope, diffWorkDir)
    let collision = 0
    while (assignedStateDirs.has(stateDir)) {
      collision += 1
      seed = `${stableName}\0#${collision}`
      stateDir = stateDirectoryForProxy(seed, profileId, scope, diffWorkDir)
    }

    assignedStateDirs.add(stateDir)
    proxy['state-dir'] = stateDir
    added.push(stateDir)
  })

  return added
}

/** A Tailscale proxy sourced from a real (non-synthetic) HTTP/File proxy-provider. */
export interface UnverifiedProviderTailscaleProxy {
  providerName: string
  proxyName: string
}

const RUNTIME_FETCHED_PROVIDER_VEHICLE_TYPES = new Set(['http', 'file'])

/**
 * Identifies Tailscale proxies sourced from HTTP/File proxy-providers. Their
 * payload is fetched by the core at runtime and is never visible to the app, so we cannot inject
 * a per-node `state-dir` for them the way we do for direct/inline proxies - and we cannot even
 * confirm from here whether the provider's own payload set one. Every such proxy is therefore "at
 * risk": if its payload does not set a unique `state-dir`, it silently collides with every other
 * unmanaged Tailscale node on the core's default state directory. Callers should warn about the
 * proxies returned here rather than attempt to fix them.
 */
export function findUnverifiedProviderTailscaleProxies(
  providers: Record<string, { vehicleType?: unknown; proxies?: { name: string; type?: unknown }[] }>
): UnverifiedProviderTailscaleProxy[] {
  const found: UnverifiedProviderTailscaleProxy[] = []

  Object.entries(providers || {}).forEach(([providerName, provider]) => {
    const vehicleType = String(provider?.vehicleType ?? '').toLowerCase()
    if (!RUNTIME_FETCHED_PROVIDER_VEHICLE_TYPES.has(vehicleType)) return
    ;(provider?.proxies ?? []).forEach((proxy) => {
      if (String(proxy?.type ?? '').toLowerCase() !== 'tailscale') return
      found.push({ providerName, proxyName: proxy.name })
    })
  })

  return found
}

export function containsTailscaleAuthKey(value: unknown): boolean {
  const visited = new Set<object>()

  const visit = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== 'object') return false
    if (visited.has(candidate)) return false
    visited.add(candidate)

    if (Array.isArray(candidate)) return candidate.some(visit)
    if (!isRecord(candidate)) return false

    const authKey = candidate['auth-key']
    if (
      String(candidate.type ?? '').toLowerCase() === 'tailscale' &&
      typeof authKey === 'string' &&
      authKey.trim().length > 0
    ) {
      return true
    }

    return Object.values(candidate).some(visit)
  }

  return visit(value)
}
