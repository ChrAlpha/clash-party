import { describe, expect, it } from 'vitest'
import { shouldShowProxyWhenHidingUnavailable } from './proxy-filter'

const baseProxy: IMihomoProxy = {
  alive: true,
  extra: {},
  history: [],
  id: 'id',
  name: 'proxy',
  tfo: false,
  type: 'Shadowsocks',
  udp: false,
  uot: false,
  xudp: false,
  mptcp: false,
  smux: false
}

const group: IMihomoGroup = {
  alive: true,
  all: [],
  extra: {},
  hidden: false,
  history: [],
  icon: '',
  name: 'group',
  now: '',
  tfo: false,
  type: 'Selector',
  udp: false,
  xudp: false
}

describe('shouldShowProxyWhenHidingUnavailable', () => {
  it('always keeps groups', () => {
    expect(shouldShowProxyWhenHidingUnavailable(group)).toBe(true)
  })

  it('keeps a proxy with no history', () => {
    expect(shouldShowProxyWhenHidingUnavailable({ ...baseProxy, history: [] })).toBe(true)
  })

  it('hides a non-Tailscale proxy whose last delay is 0', () => {
    const proxy: IMihomoProxy = {
      ...baseProxy,
      history: [{ time: 't', delay: 0 }]
    }
    expect(shouldShowProxyWhenHidingUnavailable(proxy)).toBe(false)
  })

  it('keeps a non-Tailscale proxy whose last delay is nonzero', () => {
    const proxy: IMihomoProxy = {
      ...baseProxy,
      history: [{ time: 't', delay: 120 }]
    }
    expect(shouldShowProxyWhenHidingUnavailable(proxy)).toBe(true)
  })

  // A Tailscale node's delay is 0 until login completes,
  // so it must never be hidden by the delay===0 rule, otherwise the user
  // cannot find it again to re-test after signing in.
  it('always keeps a Tailscale proxy even when its last delay is 0', () => {
    const proxy: IMihomoProxy = {
      ...baseProxy,
      type: 'Tailscale',
      history: [{ time: 't', delay: 0 }]
    }
    expect(shouldShowProxyWhenHidingUnavailable(proxy)).toBe(true)
  })
})
