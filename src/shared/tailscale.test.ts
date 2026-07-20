import { describe, expect, it } from 'vitest'
import { extractTailscaleLogin } from './tailscale'

describe('extractTailscaleLogin', () => {
  it('extracts an interactive login URL for a plain proxy name', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](work) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://login.tailscale.com/a/abc123'
      )
    ).toEqual({
      proxyName: 'work',
      url: 'https://login.tailscale.com/a/abc123'
    })
  })

  it('trims sentence punctuation from the login URL', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](work) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://login.tailscale.com/a/abc123.'
      )
    ).toEqual({
      proxyName: 'work',
      url: 'https://login.tailscale.com/a/abc123'
    })
  })

  it('captures a proxy name containing an inner parenthesis (raw %s-interpolated names)', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](US (Home)) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://login.tailscale.com/a/abc'
      )
    ).toEqual({
      proxyName: 'US (Home)',
      url: 'https://login.tailscale.com/a/abc'
    })
  })

  it('preserves surrounding whitespace because mihomo treats it as part of the proxy identity', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](  work  ) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://login.tailscale.com/a/abc'
      )
    ).toEqual({
      proxyName: '  work  ',
      url: 'https://login.tailscale.com/a/abc'
    })
  })

  it('uses the final core marker when a crafted proxy name embeds a phishing URL', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](work) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://attacker.example/a/fake) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://login.tailscale.com/a/real'
      )
    ).toEqual({
      proxyName:
        'work) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://attacker.example/a/fake',
      url: 'https://login.tailscale.com/a/real'
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

  it('does not match when the pattern appears mid-line rather than at the start', () => {
    // A rule-match / connection log line at info level could, in principle, embed this literal
    // text via an attacker-influenced proxy or rule name pulled from a remote subscription. Since
    // IMihomoLogInfo.payload never carries a leading timestamp, a genuine login line always begins
    // with "[Tailscale](" - anchoring to the line start rejects this spoofed, non-initial match.
    expect(
      extractTailscaleLogin(
        '... matched rule [Tailscale](x) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://evil.example/a/1'
      )
    ).toBeUndefined()
  })

  it('rejects a URL with embedded credentials', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) To start this tsnet server, restart with TS_AUTHKEY set, or go to: https://user:pass@login.tailscale.com/a/abc'
      )
    ).toBeUndefined()
  })

  it('does not infer login intent or combine a marker with a URL from another line', () => {
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) connected to https://login.example.test/ordinary-status'
      )
    ).toBeUndefined()
    expect(
      extractTailscaleLogin(
        '[Tailscale](home) To start this tsnet server, restart with TS_AUTHKEY set, or go to:\n[HTTP](other) https://example.test/login'
      )
    ).toBeUndefined()
  })
})
