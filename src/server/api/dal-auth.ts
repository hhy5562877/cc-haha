/**
 * DAL Auth REST API — 取代 /api/haha-oauth（Claude OAuth）成为桌面端
 * 唯一登录体系入口。
 *
 * POST   /api/dal-auth/start    — 发起 Keycloak device flow，返回验证 URL + user code
 * GET    /api/dal-auth/poll     — 轮询一次授权结果（?state=...）
 * GET    /api/dal-auth          — 登录状态（不回传 token 本体）
 * DELETE /api/dal-auth          — 登出（撤销会话 + 清除凭据）
 * GET    /api/dal-auth/gateway  — 网关配置（URL + token 是否已配置）
 * PUT    /api/dal-auth/gateway  — 手动覆盖网关 URL/Token（无法走 OIDC 的场景）
 */

import { z } from 'zod'
import { dalAuthService } from '../services/dalAuthService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

const GatewayOverrideSchema = z.object({
  url: z.string().trim().optional(),
  token: z.string().optional(),
})

export async function handleDalAuthApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2] // segments: ['api', 'dal-auth', <action?>]

    if (action === 'start' && req.method === 'POST') {
      const session = await dalAuthService.startDeviceLogin()
      return Response.json(session)
    }

    if (action === 'poll' && req.method === 'GET') {
      const state = _url.searchParams.get('state')
      if (!state) throw ApiError.badRequest('Missing "state" query parameter')
      const result = await dalAuthService.pollDeviceLogin(state)
      return Response.json(result)
    }

    if ((action === undefined || action === 'status') && req.method === 'GET') {
      return Response.json(await dalAuthService.getStatus())
    }

    if (action === undefined && req.method === 'DELETE') {
      await dalAuthService.logout()
      return Response.json({ ok: true })
    }

    if (action === 'gateway') {
      if (req.method === 'GET') {
        const status = await dalAuthService.getStatus()
        return Response.json({
          url: status.gatewayUrl,
          tokenConfigured: status.gatewayTokenConfigured,
        })
      }
      if (req.method === 'PUT') {
        let body: unknown
        try {
          body = await req.json()
        } catch {
          throw ApiError.badRequest('Invalid JSON body')
        }
        const parsed = GatewayOverrideSchema.safeParse(body)
        if (!parsed.success) {
          throw ApiError.badRequest('Expected { url?: string, token?: string }')
        }
        await dalAuthService.setGatewayOverride(parsed.data)
        return Response.json({ ok: true })
      }
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}
