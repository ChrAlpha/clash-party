import { createHash } from 'crypto'
import { dialog, Notification } from 'electron'
import i18next from 'i18next'
import * as chromeRequest from '../utils/chromeRequest'
import { getAppConfig } from '../config/app'
import { getControledMihomoConfig } from '../config/controledMihomo'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { TAILSCALE_AUTH_KEY_REQUIRES_GIST_ENCRYPTION_ERROR } from '../../shared/tailscale'
import { getRuntimeConfigStr } from '../core/factory'
import { encryptAgeContent, generateAgeKeyPair } from '../utils/age'
import { createLogger } from '../utils/logger'
import { atomicWriteFile } from '../utils/safeFile'
import { parse } from '../utils/yaml'
import { containsTailscaleAuthKey } from '../core/tailscale'

interface GistInfo {
  id: string
  description: string
  html_url: string
}

interface GistAgeKeyPair {
  secretKey: string
  recipient: string
}

const gistApiLogger = createLogger('GistApi')
let runtimeConfigUploadTimer: ReturnType<typeof setTimeout> | undefined
let runtimeConfigUploadQueue: Promise<void> = Promise.resolve()
let lastUploadedRuntimeConfigHash: string | undefined
// Tracks whether the user has already been notified that scheduled Gist sync is currently
// blocked by a plaintext Tailscale auth-key without age encryption enabled, so we notify once per
// condition change rather than on every scheduled sync attempt while it persists.
let tailscaleAuthKeyGistSyncBlockedNotified = false
let uploadingRuntimeConfigHash: string | undefined

function hashRuntimeConfig(runtimeConfig: string): string {
  return createHash('sha256').update(runtimeConfig).digest('hex')
}

async function listGists(token: string): Promise<GistInfo[]> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const res = await chromeRequest.get('https://api.github.com/gists', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port
    },
    responseType: 'json'
  })
  return Array.isArray(res.data) ? res.data : []
}

async function createGist(token: string, content: string): Promise<void> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  await chromeRequest.post(
    'https://api.github.com/gists',
    {
      description: 'Auto Synced Clash Party Runtime Config',
      public: false,
      files: { 'clash-party.yaml': { content } }
    },
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port
      }
    }
  )
}

async function updateGist(token: string, id: string, content: string): Promise<void> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  await chromeRequest.patch(
    `https://api.github.com/gists/${id}`,
    {
      description: 'Auto Synced Clash Party Runtime Config',
      files: { 'clash-party.yaml': { content } }
    },
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port
      }
    }
  )
}

export async function getGistUrl(): Promise<string> {
  const { githubToken } = await getAppConfig()
  if (!githubToken) return ''
  const gists = await listGists(githubToken)
  const gist = gists.find((gist) => gist.description === 'Auto Synced Clash Party Runtime Config')
  if (gist) {
    return gist.html_url
  } else {
    await uploadRuntimeConfig()
    const gists = await listGists(githubToken)
    const gist = gists.find((gist) => gist.description === 'Auto Synced Clash Party Runtime Config')
    if (!gist) throw new Error('Gist not found')
    return gist.html_url
  }
}

async function uploadRuntimeConfigContent(runtimeConfig: string): Promise<boolean> {
  const { githubToken, gistAgeEncrypt = false, gistAgeRecipient } = await getAppConfig()
  if (!githubToken) return false
  if (!gistAgeEncrypt && containsTailscaleAuthKey(parse<{ proxies?: unknown }>(runtimeConfig))) {
    // Kept as a stable, untranslated marker string (see shared/tailscale.ts) rather than an Error
    // subclass: it must still be recognizable both here (same process) and by the renderer after
    // crossing the Electron IPC boundary, which does not preserve custom Error prototypes
    // after crossing the Electron IPC boundary.
    throw new Error(TAILSCALE_AUTH_KEY_REQUIRES_GIST_ENCRYPTION_ERROR)
  }
  const gists = await listGists(githubToken)
  const gist = gists.find((gist) => gist.description === 'Auto Synced Clash Party Runtime Config')
  const config = gistAgeEncrypt
    ? await encryptAgeContent(runtimeConfig, gistAgeRecipient, 'gist runtime config')
    : runtimeConfig
  if (gist) {
    await updateGist(githubToken, gist.id, config)
  } else {
    await createGist(githubToken, config)
  }
  return true
}

export async function uploadRuntimeConfig(): Promise<void> {
  const runtimeConfig = await getRuntimeConfigStr()
  const runtimeConfigHash = hashRuntimeConfig(runtimeConfig)
  uploadingRuntimeConfigHash = runtimeConfigHash
  try {
    const uploaded = await uploadRuntimeConfigContent(runtimeConfig)
    if (uploaded) {
      lastUploadedRuntimeConfigHash = runtimeConfigHash
    }
  } finally {
    if (uploadingRuntimeConfigHash === runtimeConfigHash) {
      uploadingRuntimeConfigHash = undefined
    }
  }
}

export async function uploadRuntimeConfigIfChanged(): Promise<void> {
  const runtimeConfig = await getRuntimeConfigStr()
  const runtimeConfigHash = hashRuntimeConfig(runtimeConfig)
  if (
    runtimeConfigHash === lastUploadedRuntimeConfigHash ||
    runtimeConfigHash === uploadingRuntimeConfigHash
  ) {
    return
  }

  uploadingRuntimeConfigHash = runtimeConfigHash
  try {
    const uploaded = await uploadRuntimeConfigContent(runtimeConfig)
    if (uploaded) {
      lastUploadedRuntimeConfigHash = runtimeConfigHash
    }
  } finally {
    if (uploadingRuntimeConfigHash === runtimeConfigHash) {
      uploadingRuntimeConfigHash = undefined
    }
  }
}

export function scheduleRuntimeConfigUpload(): void {
  if (runtimeConfigUploadTimer) {
    clearTimeout(runtimeConfigUploadTimer)
  }

  runtimeConfigUploadTimer = setTimeout(() => {
    runtimeConfigUploadTimer = undefined
    runtimeConfigUploadQueue = runtimeConfigUploadQueue
      .catch(() => {})
      .then(async () => {
        try {
          await uploadRuntimeConfigIfChanged()
          tailscaleAuthKeyGistSyncBlockedNotified = false
        } catch (error) {
          gistApiLogger.warn('Failed to sync runtime config to Gist', error)
          notifyTailscaleAuthKeyGistSyncBlockedOnce(error)
        }
      })
  }, 300)
}

function isTailscaleAuthKeyGistEncryptionError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === TAILSCALE_AUTH_KEY_REQUIRES_GIST_ENCRYPTION_ERROR
  )
}

// Scheduled Gist sync previously swallowed this specific failure with a warn-log
// only, so auto-sync silently stopped with no user-visible signal. Fire a proactive, translated
// OS notification the first time the condition appears, and stay quiet on every following tick
// while it persists so we don't spam the user; reset as soon as sync succeeds or fails for an
// unrelated reason.
function notifyTailscaleAuthKeyGistSyncBlockedOnce(error: unknown): void {
  if (!isTailscaleAuthKeyGistEncryptionError(error)) {
    tailscaleAuthKeyGistSyncBlockedNotified = false
    return
  }
  if (tailscaleAuthKeyGistSyncBlockedNotified) return
  tailscaleAuthKeyGistSyncBlockedNotified = true

  new Notification({
    title: i18next.t('mihomo.gist.notification.tailscaleAuthKeyBlocked.title'),
    body: i18next.t('mihomo.gist.notification.tailscaleAuthKeyBlocked.body')
  }).show()
}

export async function generateGistAgeKeyPair(): Promise<GistAgeKeyPair> {
  return await generateAgeKeyPair()
}

export async function exportGistAgeSecretKey(): Promise<boolean> {
  const { gistAgeSecretKey } = await getAppConfig()
  if (!gistAgeSecretKey) {
    throw new Error('Gist Age private key has not been generated')
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Gist Age Private Key',
    defaultPath: 'clash-party-gist-age-secret-key.txt',
    filters: [{ name: 'Text File', extensions: ['txt'] }]
  })

  if (canceled || !filePath) return false

  await atomicWriteFile(filePath, `${gistAgeSecretKey.trim()}\n`, { encoding: 'utf8', mode: 0o600 })
  return true
}
