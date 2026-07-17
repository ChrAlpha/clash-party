import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extractTailscaleLogin, type TailscaleLogin } from '../../../../shared/tailscale'

const PROMPT_DEDUPLICATION_MS = 5 * 60 * 1000

const TailscaleLoginPrompt: React.FC = () => {
  const { t } = useTranslation()
  const [requests, setRequests] = useState<TailscaleLogin[]>([])
  const lastPromptedAt = useRef(new Map<string, number>())
  const request = requests[0]

  const closeCurrent = useCallback((): void => {
    setRequests((current) => current.slice(1))
  }, [])

  useEffect(() => {
    const onLog = (_event: unknown, ...args: unknown[]): void => {
      const log = args[0] as Partial<IMihomoLogInfo> | undefined
      if (typeof log?.payload !== 'string') return

      const login = extractTailscaleLogin(log.payload)
      if (!login) return

      const key = `${login.proxyName}\0${login.url}`
      const now = Date.now()
      if (lastPromptedAt.current.size >= 100) {
        lastPromptedAt.current.forEach((timestamp, promptKey) => {
          if (now - timestamp >= PROMPT_DEDUPLICATION_MS) {
            lastPromptedAt.current.delete(promptKey)
          }
        })
      }
      if (lastPromptedAt.current.size >= 100) return
      if (now - (lastPromptedAt.current.get(key) || 0) < PROMPT_DEDUPLICATION_MS) return

      lastPromptedAt.current.set(key, now)
      setRequests((current) => {
        if (current.some((item) => item.proxyName === login.proxyName && item.url === login.url)) {
          return current
        }
        return [...current.slice(-4), login]
      })
    }

    window.electron.ipcRenderer.on('mihomoLogs', onLog)
    return (): void => {
      window.electron.ipcRenderer.removeListener('mihomoLogs', onLog)
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
                  closeCurrent()
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
