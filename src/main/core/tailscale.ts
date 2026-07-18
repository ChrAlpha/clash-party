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
  name: unknown,
  profileId: string,
  scope: string,
  diffWorkDir: boolean
): string {
  const stableName = typeof name === 'string' && name.trim() ? name.trim() : 'unnamed'
  const id = createHash('sha256')
    .update(profileId)
    .update('\0')
    .update(scope)
    .update('\0')
    .update(stableName)
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

  tailscaleProxies(profile).forEach(({ proxy, scope }) => {
    const existingStateDir = proxy['state-dir']
    if (typeof existingStateDir === 'string' && existingStateDir.trim()) return

    const stateDir = stateDirectoryForProxy(proxy.name, profileId, scope, diffWorkDir)
    proxy['state-dir'] = stateDir
    added.push(stateDir)
  })

  return added
}

export function containsTailscaleAuthKey(profile: MihomoProfile): boolean {
  return tailscaleProxies(profile).some(({ proxy }) => {
    const authKey = proxy['auth-key']
    return typeof authKey === 'string' && authKey.trim().length > 0
  })
}
