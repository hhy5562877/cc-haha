// desktop/src/components/settings/DalGatewayLogin.tsx
//
// DAL 网关登录卡片内容：Keycloak device flow 登录 / 登出 / 账号状态 /
// 网关手动配置（URL + Token 覆盖）。取代原 ClaudeOfficialLogin 的挂载位置。
//
// 流程：点击登录 → server 发起 device flow → 系统浏览器打开验证链接 →
// 前端按 interval 轮询 /api/dal-auth/poll → 授权完成后刷新登录态与模型目录。

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { dalAuthApi } from '../../api/dalAuth'
import { useDalAuthStore } from '../../stores/dalAuthStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'

export function DalGatewayLogin() {
  const t = useTranslation()
  const {
    status,
    isLoading,
    error,
    pendingSession,
    loginPhase,
    fetchStatus,
    startLogin,
    cancelLogin,
    logout,
  } = useDalAuthStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)
  const [showGatewayConfig, setShowGatewayConfig] = useState(false)
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [gatewayToken, setGatewayToken] = useState('')
  const [gatewaySaveFailed, setGatewaySaveFailed] = useState(false)

  useEffect(() => {
    void fetchStatus()
    return () => {
      cancelledRef.current = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 初始化网关配置表单（服务端下发的生效 URL）。
  useEffect(() => {
    if (status && !gatewayUrl) setGatewayUrl(status.gatewayUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.gatewayUrl])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const handleLogin = async () => {
    try {
      const session = await startLogin()
      try {
        await getDesktopHost().shell.open(session.verificationUriComplete)
      } catch (err) {
        console.error('[DalGatewayLogin] shellOpen failed:', err)
        useDalAuthStore.setState({ error: t('settings.dalGatewayLogin.openBrowserFailed') })
      }
      cancelledRef.current = false

      // 前端驱动的轮询：服务端每次 poll 调一次 Keycloak token endpoint。
      const tick = async () => {
        if (cancelledRef.current) return
        const current = useDalAuthStore.getState().pendingSession
        if (!current) return
        try {
          const result = await dalAuthApi.poll(current.state)
          if (cancelledRef.current) return
          if (result.status === 'complete') {
            useDalAuthStore.setState({ pendingSession: null, loginPhase: 'idle' })
            await fetchStatus()
            await fetchSettings()
            return
          }
          if (result.status === 'expired' || result.status === 'denied' || result.status === 'error') {
            useDalAuthStore.setState({
              pendingSession: null,
              loginPhase: 'error',
              error: result.status === 'expired'
                ? t('settings.dalGatewayLogin.expired')
                : 'message' in result ? result.message : t('settings.dalGatewayLogin.errorPrefix'),
            })
            return
          }
        } catch {
          // 网络抖动：继续下一轮，session 过期兜底。
        }
        pollTimerRef.current = setTimeout(tick, (current.interval || 5) * 1000)
      }
      pollTimerRef.current = setTimeout(tick, (session.interval || 5) * 1000)
    } catch {
      // store.startLogin() 已把错误写入 store.error
    }
  }

  const handleCancelLogin = () => {
    cancelledRef.current = true
    stopPolling()
    cancelLogin()
  }

  const handleSaveGateway = async () => {
    setGatewaySaveFailed(false)
    try {
      await useDalAuthStore.getState().saveGatewayConfig({
        ...(gatewayUrl.trim() ? { url: gatewayUrl.trim() } : {}),
        ...(gatewayToken.trim() ? { token: gatewayToken.trim() } : {}),
      })
      setGatewayToken('')
    } catch {
      setGatewaySaveFailed(true)
    }
  }

  if (status === null) {
    if (error) {
      return (
        <div className="text-xs text-[var(--color-error)]">
          {t('settings.dalGatewayLogin.errorPrefix')}{error}
        </div>
      )
    }
    return (
      <div className="text-xs text-[var(--color-text-tertiary)]">
        {t('common.loading')}
      </div>
    )
  }

  if (status.loggedIn) {
    const accountLabel = status.account?.email
      ?? status.account?.username
      ?? t('settings.dalGatewayLogin.accountUnknown')
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-success)]">
            ✓ {t('settings.dalGatewayLogin.loggedInPrefix')} {accountLabel}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void logout()} disabled={isLoading}>
            {isLoading
              ? t('settings.dalGatewayLogin.logoutProcessing')
              : t('settings.dalGatewayLogin.logoutButton')}
          </Button>
        </div>
        {renderGatewayConfigToggle()}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-[var(--color-text-secondary)]">
        {t('settings.dalGatewayLogin.intro')}
      </div>

      {loginPhase === 'awaiting-authorization' && pendingSession ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-3">
          <div className="text-xs text-[var(--color-text-secondary)]">
            {t('settings.dalGatewayLogin.awaitingHint')}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {t('settings.dalGatewayLogin.userCodeLabel')}
            </span>
            <code className="rounded-[var(--radius-sm)] bg-[var(--color-surface-container-high)] px-2 py-0.5 font-mono text-sm font-semibold tracking-widest text-[var(--color-text-primary)]">
              {pendingSession.userCode}
            </code>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleCancelLogin}>
              {t('settings.dalGatewayLogin.cancelLogin')}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={handleLogin} disabled={isLoading} className="self-start">
          {isLoading
            ? t('settings.dalGatewayLogin.loginStarting')
            : t('settings.dalGatewayLogin.loginButton')}
        </Button>
      )}

      {renderGatewayConfigToggle()}

      {(error || gatewaySaveFailed) && (
        <div className="text-xs text-[var(--color-error)]">
          {t('settings.dalGatewayLogin.errorPrefix')}{error || t('publicAccess.genericError')}
        </div>
      )}
    </div>
  )

  function renderGatewayConfigToggle() {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowGatewayConfig((visible) => !visible)}
          className="w-fit text-xs text-[var(--color-text-tertiary)] underline-offset-2 hover:text-[var(--color-text-secondary)] hover:underline"
        >
          {showGatewayConfig
            ? t('settings.dalGatewayLogin.manualConfigHide')
            : t('settings.dalGatewayLogin.manualConfigShow')}
        </button>
        {showGatewayConfig && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-3">
            <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">
              {t('settings.dalGatewayLogin.manualConfigHint')}
            </p>
            <Input
              label={t('settings.dalGatewayLogin.gatewayUrlLabel')}
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
              placeholder="https://api.deepailab.ai/v1"
              className="font-mono text-[13px]"
            />
            <Input
              label={t('settings.dalGatewayLogin.gatewayTokenLabel')}
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder={status?.gatewayTokenConfigured
                ? t('settings.dalGatewayLogin.gatewayTokenConfigured')
                : 'eyJhbGciOi...'}
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void handleSaveGateway()}
              disabled={isLoading || (!gatewayUrl.trim() && !gatewayToken.trim())}
            >
              {t('settings.dalGatewayLogin.gatewaySave')}
            </Button>
          </div>
        )}
      </div>
    )
  }
}
