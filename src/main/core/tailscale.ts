import { createHash } from 'crypto'

type MihomoProxyConfig = Record<string, unknown>
type MihomoProfile = { proxies?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTailscaleProxy(value: unknown): value is MihomoProxyConfig {
  return isRecord(value) && String(value.type).toLowerCase() === 'tailscale'
}

function tailscaleProxies(profile: MihomoProfile): MihomoProxyConfig[] {
  if (!Array.isArray(profile.proxies)) return []
  return profile.proxies.filter(isTailscaleProxy)
}

function stateDirectoryForName(name: unknown, profileId: string): string {
  const stableName = typeof name === 'string' && name.trim() ? name.trim() : 'unnamed'
  const id = createHash('sha256')
    .update(profileId)
    .update('\0')
    .update(stableName)
    .digest('hex')
    .slice(0, 16)
  return `tailscale/${id}`
}

export function ensureTailscaleStateDirs(profile: MihomoProfile, profileId = 'default'): number {
  let added = 0

  tailscaleProxies(profile).forEach((proxy) => {
    const stateDir = proxy['state-dir']
    if (typeof stateDir === 'string' && stateDir.trim()) return

    proxy['state-dir'] = stateDirectoryForName(proxy.name, profileId)
    added += 1
  })

  return added
}

export function containsTailscaleAuthKey(profile: MihomoProfile): boolean {
  return tailscaleProxies(profile).some((proxy) => {
    const authKey = proxy['auth-key']
    return typeof authKey === 'string' && authKey.trim().length > 0
  })
}
