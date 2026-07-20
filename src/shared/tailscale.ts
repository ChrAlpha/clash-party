export interface TailscaleLogin {
  proxyName: string
  url: string
}

export const TAILSCALE_INITIALIZE_REQUEST_EVENT = 'tailscale-initialize-request'

// Thrown by gistApi.ts's Gist runtime-config upload guard when a profile's plaintext Tailscale
// auth-key would otherwise be uploaded to Gist without age encryption enabled. Kept as a stable,
// untranslated string (rather than an Error subclass) so it can be reliably matched both in the
// main process (to decide when to fire a one-time proactive notification) and in the renderer
// (to show a translated toast) - custom Error subclasses do not survive the Electron IPC boundary
// after crossing the Electron IPC boundary.
export const TAILSCALE_AUTH_KEY_REQUIRES_GIST_ENCRYPTION_ERROR =
  'Tailscale auth-key requires Gist Runtime Config Age Encryption'

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,;!\])}]+$/u, '')
}

const TAILSCALE_LOGIN_PREFIX = '[Tailscale]('
const TAILSCALE_LOGIN_SEPARATOR =
  ') To start this tsnet server, restart with TS_AUTHKEY set, or go to: '

export function extractTailscaleLogin(payload: string): TailscaleLogin | undefined {
  for (const line of payload.split(/\r?\n/u)) {
    if (!line.startsWith(TAILSCALE_LOGIN_PREFIX)) continue

    // Proxy names are interpolated raw and may contain both parentheses and the fixed marker.
    // The core-appended marker is necessarily the final occurrence on the line; parsing from it
    // prevents a crafted proxy name from substituting an earlier attacker-controlled URL.
    const separatorIndex = line.lastIndexOf(TAILSCALE_LOGIN_SEPARATOR)
    if (separatorIndex < TAILSCALE_LOGIN_PREFIX.length) continue

    const proxyName = line.slice(TAILSCALE_LOGIN_PREFIX.length, separatorIndex)
    if (!proxyName.trim()) continue
    const candidate = trimUrlPunctuation(
      line.slice(separatorIndex + TAILSCALE_LOGIN_SEPARATOR.length).trim()
    )
    try {
      const url = new URL(candidate)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue
      return { proxyName, url: url.toString().replace(/\/$/u, '') }
    } catch {
      // Ignore malformed URLs from untrusted core log text.
    }
  }

  return undefined
}
