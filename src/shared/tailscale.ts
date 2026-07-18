export interface TailscaleLogin {
  proxyName: string
  url: string
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,;!\])}]+$/u, '')
}

const TAILSCALE_LOGIN_LOG =
  /\[Tailscale\]\(([^)\r\n]+)\)[^\S\r\n]+To start this tsnet server, restart with TS_AUTHKEY set, or go to:[^\S\r\n]+(https?:\/\/[^\s<>"']+)/iu

export function extractTailscaleLogin(payload: string): TailscaleLogin | undefined {
  for (const line of payload.split(/\r?\n/u)) {
    const tailscaleLog = line.match(TAILSCALE_LOGIN_LOG)
    if (!tailscaleLog) continue

    const [, proxyName, rawUrl] = tailscaleLog
    const candidate = trimUrlPunctuation(rawUrl)
    try {
      const url = new URL(candidate)
      if (url.username || url.password) continue
      return { proxyName: proxyName.trim(), url: url.toString().replace(/\/$/u, '') }
    } catch {
      // Ignore malformed URLs from untrusted core log text.
    }
  }

  return undefined
}
