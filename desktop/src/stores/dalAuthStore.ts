// desktop/src/stores/dalAuthStore.ts
//
// DAL 登录状态 store：device flow 发起、授权轮询、状态刷新、登出与网关配置。
// 取代原 hahaOAuthStore（Claude OAuth）。登录成功后刷新设置存储，让
// /api/models 下发的 DAL 模型目录进入 UI。

import { create } from 'zustand'
import { dalAuthApi, type DalAuthStatus, type DalDeviceSession } from '../api/dalAuth'
import { useSettingsStore } from './settingsStore'

type DalLoginPhase = 'idle' | 'awaiting-authorization' | 'error'

type DalAuthState = {
  status: DalAuthStatus | null
  isLoading: boolean
  error: string | null

  /** 进行中的 device flow 会话；null 表示没有待确认的登录。 */
  pendingSession: DalDeviceSession | null
  loginPhase: DalLoginPhase

  fetchStatus: () => Promise<void>
  startLogin: () => Promise<DalDeviceSession>
  cancelLogin: () => void
  logout: () => Promise<void>
  saveGatewayConfig: (input: { url?: string; token?: string }) => Promise<void>
}

export const useDalAuthStore = create<DalAuthState>((set, get) => ({
  status: null,
  isLoading: false,
  error: null,
  pendingSession: null,
  loginPhase: 'idle',

  fetchStatus: async () => {
    try {
      const previous = get().status
      const status = await dalAuthApi.status()
      set({ status, error: null })
      // 登录态变化后模型目录（/api/models）会换血，刷新设置存储。
      if (status.loggedIn !== (previous?.loggedIn ?? false)) {
        await useSettingsStore.getState().fetchAll()
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  startLogin: async () => {
    set({ isLoading: true, error: null, loginPhase: 'idle' })
    try {
      const session = await dalAuthApi.start()
      set({ pendingSession: session, loginPhase: 'awaiting-authorization', isLoading: false })
      return session
    } catch (err) {
      set({
        isLoading: false,
        loginPhase: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  cancelLogin: () => {
    set({ pendingSession: null, loginPhase: 'idle' })
  },

  logout: async () => {
    set({ isLoading: true })
    try {
      await dalAuthApi.logout()
      set({
        status: {
          loggedIn: false,
          expiresAt: null,
          account: null,
          gatewayUrl: get().status?.gatewayUrl ?? '',
          gatewayTokenConfigured: false,
        },
        pendingSession: null,
        loginPhase: 'idle',
        isLoading: false,
      })
      await useSettingsStore.getState().fetchAll()
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  saveGatewayConfig: async (input) => {
    set({ isLoading: true, error: null })
    try {
      await dalAuthApi.setGatewayConfig(input)
      await get().fetchStatus()
      await useSettingsStore.getState().fetchAll()
      set({ isLoading: false })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },
}))
