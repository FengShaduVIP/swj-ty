import type { DispatchUploadRecord } from '@/dispatch/uploadDecision'
import { backendUrl } from './backendConfig.ts'

export const DISPATCH_UPLOAD_URL = backendUrl('/iot/bms-param-dispatch-latest/upload')
const UPLOAD_TIMEOUT_MS = 10_000

interface UploadFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type UploadFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: { Authorization: string; 'Content-Type': string }
    signal: AbortSignal
    body: string
  },
) => Promise<UploadFetchResponse>

interface UploadApiResponse {
  code?: unknown
  msg?: unknown
  data?: unknown
}

export async function uploadDispatchRecord(
  record: DispatchUploadRecord,
  accessToken: string,
  fetchImpl: UploadFetch = fetch,
): Promise<boolean> {
  let response: UploadFetchResponse
  let result: UploadApiResponse
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    try {
      response = await fetchImpl(DISPATCH_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(record),
      })
    } catch {
      throw new Error('无法上传下发记录，请检查网络后重试')
    }

    if (!response.ok) throw new Error(`上传下发记录失败（HTTP ${response.status}）`)

    try {
      result = (await response.json()) as UploadApiResponse
    } catch {
      if (controller.signal.aborted) throw new Error('无法上传下发记录，请检查网络后重试')
      throw new Error('上传下发记录服务返回数据格式错误')
    }
  } finally {
    clearTimeout(timeoutId)
  }

  if (result.code !== 200) throw new Error(String(result.msg || '上传下发记录失败'))
  return true
}
