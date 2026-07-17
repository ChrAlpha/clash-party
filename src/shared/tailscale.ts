export interface TailscaleLogin {
  proxyName: string
  url: string
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,;!\])}]+$/u, '')
}

export function extractTailscaleLogin(payload: string): TailscaleLogin | undefined {
  const tailscaleLog = payload.match(/\[Tailscale\]\(([^)\r\n]+)\)\s+(.+)/iu)
  if (!tailscaleLog) return undefined

  const [, proxyName, message] = tailscaleLog
  if (!/(?:authenticat|log[\s-]?in|login|visit)/iu.test(message)) return undefined

  for (const match of message.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
    const candidate = trimUrlPunctuation(match[0])
    try {
      const url = new URL(candidate)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      if (url.username || url.password) continue
      return { proxyName: proxyName.trim(), url: url.toString().replace(/\/$/u, '') }
    } catch {
      // Ignore malformed URLs from untrusted core log text.
    }
  }

  return undefined
}
