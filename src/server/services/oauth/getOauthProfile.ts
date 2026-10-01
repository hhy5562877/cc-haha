import axios from 'axios'
import { getOauthConfig, OAUTH_BETA_HEADER } from 'src/server/constants/oauth.ts'
import type { OAuthProfileResponse } from './types.js'
import { getAnthropicApiKey } from 'src/utils/auth.js'
import { getGlobalConfig } from 'src/server/utils/config.js'
import { logError } from 'src/server/utils/log.ts'
import { getAxiosProxyOptions } from 'src/server/utils/proxy.ts'

export type OAuthProfileFetchOptions = {
  proxyUrl?: string | null
}

export async function getOauthProfileFromApiKey(): Promise<
  OAuthProfileResponse | undefined
> {
  // Assumes interactive session
  const config = getGlobalConfig()
  const accountUuid = config.oauthAccount?.accountUuid
  const apiKey = getAnthropicApiKey()

  // Need both account UUID and API key to check
  if (!accountUuid || !apiKey) {
    return
  }
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli_profile`
  try {
    const response = await axios.get<OAuthProfileResponse>(endpoint, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
      params: {
        account_uuid: accountUuid,
      },
      timeout: 10000,
    })
    return response.data
  } catch (error) {
    logError(error as Error)
  }
}

export async function getOauthProfileFromOauthToken(
  accessToken: string,
  options: OAuthProfileFetchOptions = {},
): Promise<OAuthProfileResponse | undefined> {
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/oauth/profile`
  try {
    const response = await axios.get<OAuthProfileResponse>(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
      ...getAxiosProxyOptions(options.proxyUrl),
    })
    return response.data
  } catch (error) {
    logError(error as Error)
  }
}
