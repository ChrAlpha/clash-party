import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
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

    const hydrationGeneration = cacheGeneration
    void mihomoTailscaleLogins()
      .then((logins) => {
        if (!active || cacheGeneration !== hydrationGeneration) return
        let nextRequests: TailscaleLogin[] | undefined
        for (const login of logins) {
          if (isTailscaleLogin(login)) nextRequests = queue.current.record(login)
        }
        if (nextRequests) setRequests(nextRequests)
      })
      .catch(() => {})

    return (): void => {
      active = false
      window.electron.ipcRenderer.removeListener('mihomoLogs', onLog)
      window.electron.ipcRenderer.removeListener('tailscaleLoginCacheCleared', onCacheCleared)
      window.removeEventListener(TAILSCALE_INITIALIZE_REQUEST_EVENT, onInitializeRequest)
    }
  }, [])

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
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={closeCurrent}>
                {t('common.cancel')}
              </Button>
              <Button
                color="primary"
                onPress={() => {
                  window.open(request.url, '_blank', 'noopener,noreferrer')
                  setRequests(queue.current.openCurrent())
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
