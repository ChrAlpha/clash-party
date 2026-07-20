// 判断在开启"隐藏不可用节点"时，某个节点/分组是否应当保留在列表中
export function shouldShowProxyWhenHidingUnavailable(proxy: IMihomoProxy | IMihomoGroup): boolean {
  const isGroup = 'all' in proxy
  if (isGroup) {
    return true
  }
  // Tailscale 节点在登录完成前 delay 恒为 0，不能按普通延迟规则隐藏，
  // 否则用户在登录超时后无法再找到该节点进行重新测速。
  if (proxy.type === 'Tailscale') {
    return true
  }
  if (!proxy.history || proxy.history.length === 0) {
    return true
  }
  const lastDelay = proxy.history[proxy.history.length - 1].delay
  return lastDelay !== 0
}
