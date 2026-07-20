import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAILSCALE_AUTH_KEY_REQUIRES_GIST_ENCRYPTION_ERROR } from '../../shared/tailscale'

// The Gist auth-key guard must (a) throw a stable, matchable error so callers on
// both sides of the Electron IPC boundary can map it to a translated message instead of a raw
// English string, and (b) make scheduled sync proactively notify the user once per condition
// change instead of silently stopping.

const notificationShow = vi.fn()
const getAppConfigMock = vi.fn()
const getRuntimeConfigStrMock = vi.fn()
const chromeGet = vi.fn()
const chromePost = vi.fn()
const chromePatch = vi.fn()

vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn() },
  Notification: class {
    private opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
    }
    show(): void {
      notificationShow(this.opts)
    }
  }
}))

vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))

vi.mock('../config/app', () => ({
  getAppConfig: (...args: unknown[]) => getAppConfigMock(...args)
}))

vi.mock('../config/controledMihomo', () => ({
  getControledMihomoConfig: vi.fn().mockResolvedValue({ 'mixed-port': 9090 })
}))

vi.mock('../utils/chromeRequest', () => ({
  get: (...args: unknown[]) => chromeGet(...args),
  post: (...args: unknown[]) => chromePost(...args),
  patch: (...args: unknown[]) => chromePatch(...args)
}))

vi.mock('../core/factory', () => ({
  getRuntimeConfigStr: (...args: unknown[]) => getRuntimeConfigStrMock(...args)
}))

vi.mock('../utils/age', () => ({
  encryptAgeContent: vi.fn().mockResolvedValue('encrypted'),
  generateAgeKeyPair: vi.fn().mockResolvedValue({ secretKey: 'sk', recipient: 'age1xxx' })
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })
}))

vi.mock('../utils/safeFile', () => ({
  atomicWriteFile: vi.fn().mockResolvedValue(undefined)
}))

const RUNTIME_CONFIG_WITH_AUTH_KEY =
  'proxies:\n  - name: tailnet\n    type: tailscale\n    auth-key: secret-value\n'
const RUNTIME_CONFIG_WITHOUT_AUTH_KEY = 'proxies:\n  - name: plain\n    type: ss\n'

beforeEach(() => {
  notificationShow.mockReset()
  getAppConfigMock.mockReset()
  getRuntimeConfigStrMock.mockReset()
  chromeGet.mockReset().mockResolvedValue({ data: [] })
  chromePost.mockReset().mockResolvedValue(undefined)
  chromePatch.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('uploadRuntimeConfig auth-key guard', () => {
  it('throws the shared sentinel error when age encryption is disabled and a Tailscale auth-key is present', async () => {
    const { uploadRuntimeConfig } = await import('./gistApi')
    getAppConfigMock.mockResolvedValue({ githubToken: 'tok', gistAgeEncrypt: false })
    getRuntimeConfigStrMock.mockResolvedValue(RUNTIME_CONFIG_WITH_AUTH_KEY)

    await expect(uploadRuntimeConfig()).rejects.toThrow(
      TAILSCALE_AUTH_KEY_REQUIRES_GIST_ENCRYPTION_ERROR
    )
    expect(chromeGet).not.toHaveBeenCalled()
  })

  it('does not throw and uploads normally when age encryption is enabled', async () => {
    const { uploadRuntimeConfig } = await import('./gistApi')
    getAppConfigMock.mockResolvedValue({
      githubToken: 'tok',
      gistAgeEncrypt: true,
      gistAgeRecipient: 'age1xxx'
    })
    getRuntimeConfigStrMock.mockResolvedValue(RUNTIME_CONFIG_WITH_AUTH_KEY)

    await expect(uploadRuntimeConfig()).resolves.toBeUndefined()
    expect(chromePost).toHaveBeenCalledTimes(1)
  })

  it('does not throw when no Tailscale auth-key is present, even without encryption', async () => {
    const { uploadRuntimeConfig } = await import('./gistApi')
    getAppConfigMock.mockResolvedValue({ githubToken: 'tok', gistAgeEncrypt: false })
    getRuntimeConfigStrMock.mockResolvedValue(RUNTIME_CONFIG_WITHOUT_AUTH_KEY)

    await expect(uploadRuntimeConfig()).resolves.toBeUndefined()
    expect(chromePost).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no GitHub token is configured', async () => {
    const { uploadRuntimeConfig } = await import('./gistApi')
    getAppConfigMock.mockResolvedValue({ githubToken: '' })
    getRuntimeConfigStrMock.mockResolvedValue(RUNTIME_CONFIG_WITH_AUTH_KEY)

    await expect(uploadRuntimeConfig()).resolves.toBeUndefined()
    expect(chromeGet).not.toHaveBeenCalled()
  })
})

describe('scheduleRuntimeConfigUpload notification', () => {
  it('notifies once per condition change instead of on every scheduled tick', async () => {
    vi.resetModules()
    const { scheduleRuntimeConfigUpload } = await import('./gistApi')
    vi.useFakeTimers()

    // Tick 1: blocked by the auth-key condition -> notify.
    getAppConfigMock.mockResolvedValue({ githubToken: 'tok', gistAgeEncrypt: false })
    getRuntimeConfigStrMock.mockResolvedValue(RUNTIME_CONFIG_WITH_AUTH_KEY)
    scheduleRuntimeConfigUpload()
    await vi.advanceTimersByTimeAsync(300)
    expect(notificationShow).toHaveBeenCalledTimes(1)
    expect(notificationShow.mock.calls[0][0]).toMatchObject({
      title: 'mihomo.gist.notification.tailscaleAuthKeyBlocked.title'
    })

    // Tick 2: same condition persists -> do not spam a second notification.
    scheduleRuntimeConfigUpload()
    await vi.advanceTimersByTimeAsync(300)
    expect(notificationShow).toHaveBeenCalledTimes(1)

    // Tick 3: condition clears (encryption enabled) -> sync succeeds, resetting the dedup state.
    getAppConfigMock.mockResolvedValue({
      githubToken: 'tok',
      gistAgeEncrypt: true,
      gistAgeRecipient: 'age1xxx'
    })
    getRuntimeConfigStrMock.mockResolvedValue(RUNTIME_CONFIG_WITHOUT_AUTH_KEY)
    scheduleRuntimeConfigUpload()
    await vi.advanceTimersByTimeAsync(300)
    expect(notificationShow).toHaveBeenCalledTimes(1)

    // Tick 4: condition reappears -> notify again, since it is a fresh condition change.
    getAppConfigMock.mockResolvedValue({ githubToken: 'tok', gistAgeEncrypt: false })
    getRuntimeConfigStrMock.mockResolvedValue(RUNTIME_CONFIG_WITH_AUTH_KEY)
    scheduleRuntimeConfigUpload()
    await vi.advanceTimersByTimeAsync(300)
    expect(notificationShow).toHaveBeenCalledTimes(2)
  })
})
