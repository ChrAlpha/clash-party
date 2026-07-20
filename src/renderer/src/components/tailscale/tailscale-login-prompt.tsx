import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { mihomoTailscaleLogins } from '@renderer/utils/ipc'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  extractTailscaleLogin,
  TAILSCALE_INITIALIZE_REQUEST_EVENT,
  type TailscaleLogin
} from '../../../../shared/tailscale'
import { TailscaleLoginQueue } from './tailscale-login-queue'

function isTailscaleLogin(value: unknown): value is TailscaleLogin {
  if (!value || typeof value !== 'object') return false
  const login = value as Partial<TailscaleLogin>
  return typeof login.proxyName === 'string' && typeof login.url === 'string'
}

const TailscaleLoginPrompt: React.FC = () => {
  const { t } = useTranslation()
  const queue = useRef(new TailscaleLoginQueue())
  const [requests, setRequests] = useState<TailscaleLogin[]>([])
  const request = requests[0]

  const closeCurrent = useCallback((): void => {
    setRequests(queue.current.closeCurrent())
  }, [])

  useEffect(() => {
    let active = true
    let cacheGeneration = 0

    const onLog = (_event: unknown, ...args: unknown[]): void => {
      const log = args[0] as Partial<IMihomoLogInfo> | undefined
      if (typeof log?.payload !== 'string') return

      const login = extractTailscaleLogin(log.payload)
      if (!login) return
      setRequests(queue.current.record(login))
    }

    const onInitializeRequest = (event: Event): void => {
      const proxyName = (event as CustomEvent<unknown>).detail
      if (typeof proxyName !== 'string') return

      const requestGeneration = cacheGeneration
      void mihomoTailscaleLogins()
        .then((logins) => {
          if (!active || cacheGeneration !== requestGeneration) return
          const matchingLogins = logins.filter(
            (login) => isTailscaleLogin(login) && login.proxyName === proxyName
          )
          if (matchingLogins.length === 1) {
            setRequests(queue.current.replay(matchingLogins[0]))
          }
        })
        .catch(() => {})
    }

    const onCacheCleared = (): void => {
      cacheGeneration += 1
      setRequests(queue.current.clear())
    }

    window.electron.ipcRenderer.on('mihomoLogs', onLog)
    window.electron.ipcRenderer.on('tailscaleLoginCacheCleared', onCacheCleared)
    window.addEventListener(TAILSCALE_INITIALIZE_REQUEST_EVENT, onInitializeRequest)

    // Intentionally do NOT hydrate cached logins as active prompts on mount: the main-process
    // cache can hold logins that were already completed or cancelled in a previous window
    // instance (this queue's in-memory dismissal state does not survive a remount), so blindly
    // record()-ing every cached login here used to burst up to 5 stale modals right after the
    // main window was recreated. Cached logins stay available for replay only -
    // via the explicit TAILSCALE_INITIALIZE_REQUEST_EVENT path above, which queries the cache
    // fresh on demand (onInitializeRequest) - and a modal is otherwise only (re)opened from a
    // genuinely fresh /logs line (onLog). Both paths go through TailscaleLoginQueue, so
    // dismissed/suppressed logins are respected here too; the cacheGeneration guard above
    // still protects onInitializeRequest/onCacheCleared against races with cache invalidation.

    return (): void => {
      active = false
      window.electron.ipcRenderer.removeListener('mihomoLogs', onLog)
      window.electron.ipcRenderer.removeListener('tailscaleLoginCacheCleared', onCacheCleared)
      window.removeEventListener(TAILSCALE_INITIALIZE_REQUEST_EVENT, onInitializeRequest)
    }
  }, [])

  const onCopy = useCallback((): void => {
    if (!request) return
    navigator.clipboard
      .writeText(request.url)
      .then(() => toast.success(t('tailscale.login.copied')))
      .catch(() => {})
  }, [request, t])

  return (
    <Modal isOpen={Boolean(request)} onOpenChange={(open) => !open && closeCurrent()} size="lg">
      <ModalContent>
        {request && (
          <>
            <ModalHeader>{t('tailscale.login.title', { name: request.proxyName })}</ModalHeader>
            <ModalBody>
              <p>{t('tailscale.login.description')}</p>
              <code className="select-text break-all rounded-medium bg-default-100 p-3 text-sm">
                {request.url}
              </code>
              <p className="text-sm text-warning">{t('tailscale.login.security')}</p>
              <p className="text-sm text-foreground-500">{t('tailscale.login.afterSignIn')}</p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={closeCurrent}>
                {t('common.cancel')}
              </Button>
              <Button variant="light" onPress={onCopy}>
                {t('tailscale.login.copy')}
              </Button>
              <Button
                color="primary"
                onPress={() => {
                  // Keep the modal open after opening the link: the browser open
                  // can silently fail (no default handler, popup blocked, etc.), so the user
                  // must still be able to copy the URL or retry from here. Only Cancel (or the
                  // modal's own close affordances, which route through closeCurrent) dismisses.
                  window.open(request.url, '_blank', 'noopener,noreferrer')
                }}
              >
                {t('tailscale.login.open')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export default TailscaleLoginPrompt
