// desktop/src/api/dalAuth.ts
//
// DAL 登录 REST 客户端：Keycloak device flow + 网关配置。
// 取代原 hahaOAuth.ts（Claude OAuth）。

import { api } from './client'

export type DalAuthStatus = {
  loggedIn: boolean
  expiresAt: number | null
  account: {
    subject?: string
    email?: string | null
    username?: string | null
  } | null
  gatewayUrl: string
  gatewayTokenConfigured: boolean
}

export type DalDeviceSession = {
  state: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  interval: number
  expiresIn: number
}

export type DalPollResult =
  | { status: 'pending' }
  | { status: 'complete' }
  | { status: 'expired' }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string }

export type DalGatewayConfig = {
  url: string
  tokenConfigured: boolean
}

export const dalAuthApi = {
  start() {
    return api.post<DalDeviceSession>('/api/dal-auth/start', {})
  },

  poll(state: string) {
    return api.get<DalPollResult>(`/api/dal-auth/poll?state=${encodeURIComponent(state)}`)
  },

  status() {
    return api.get<DalAuthStatus>('/api/dal-auth')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/dal-auth')
  },

  gatewayConfig() {
    return api.get<DalGatewayConfig>('/api/dal-auth/gateway')
  },

  setGatewayConfig(input: { url?: string; token?: string }) {
    return api.put<{ ok: true }>('/api/dal-auth/gateway', input)
  },
}
