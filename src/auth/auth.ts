import { backendUrl } from './backendConfig.ts'

export const LOGIN_URL = backendUrl('/system/auth/login')
const LOGIN_TIMEOUT_MS = 10_000

export interface AuthSession {
  userId: number
  username: string
  accessToken: string
  expiresTime: number
}

interface LoginFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type LoginFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: { 'Content-Type': string }
    signal: AbortSignal
    body: string
  },
) => Promise<LoginFetchResponse>

interface LoginApiData {
  userId?: unknown
  accessToken?: unknown
  expiresTime?: unknown
}

interface LoginApiResponse {
  code?: unknown
  msg?: unknown
  data?: LoginApiData | null
}

export async function loginBackend(
  username: string,
  password: string,
  fetchImpl: LoginFetch = fetch,
): Promise<AuthSession> {
  const loginUsername = username.trim()
  if (!loginUsername || !password) throw new Error('请输入用户名和密码')

  let response: LoginFetchResponse
  let result: LoginApiResponse
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS)
  try {
    try {
      response = await fetchImpl(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ tenantName: '', username: loginUsername, password, rememberMe: true }),
      })
    } catch {
      throw new Error('无法连接登录服务，请检查网络后重试')
    }

    if (!response.ok) throw new Error(`登录服务异常（HTTP ${response.status}）`)

    try {
      result = (await response.json()) as LoginApiResponse
    } catch {
      if (controller.signal.aborted) throw new Error('无法连接登录服务，请检查网络后重试')
      throw new Error('登录服务返回数据格式错误')
    }
  } finally {
    clearTimeout(timeoutId)
  }

  if (result.code !== 200) throw new Error(String(result.msg || '登录失败'))

  const data = result.data
  const userId = data?.userId
  const accessToken = data?.accessToken
  const expiresTime = data?.expiresTime
  if (
    typeof userId !== 'number' ||
    typeof accessToken !== 'string' ||
    !accessToken ||
    typeof expiresTime !== 'number' ||
    !Number.isFinite(expiresTime)
  ) {
    throw new Error('登录服务返回数据格式错误')
  }

  return { userId, username: loginUsername, accessToken, expiresTime }
}

export function isAuthSessionValid(
  session: Pick<AuthSession, 'expiresTime'> | null | undefined,
  now: number = Date.now(),
): session is Pick<AuthSession, 'expiresTime'> {
  return !!session && typeof session.expiresTime === 'number' && session.expiresTime > now
}

export function canDispatchParameters(
  connected: boolean,
  session: Pick<AuthSession, 'expiresTime'> | null | undefined,
  now: number = Date.now(),
): boolean {
  return connected && isAuthSessionValid(session, now)
}
