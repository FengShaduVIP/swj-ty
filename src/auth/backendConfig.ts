const DEFAULT_BACKEND_API_BASE_URL = 'https://ty.chuanaitec.cn/admin-api'

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
}

interface ImportMetaWithEnv {
  readonly env?: ImportMetaEnv
}

export function resolveBackendApiBaseUrl(configuredBaseUrl?: string): string {
  const configured = (
    configuredBaseUrl ?? (import.meta as ImportMetaWithEnv).env?.VITE_API_BASE_URL
  )?.trim()
  if (!configured) return DEFAULT_BACKEND_API_BASE_URL
  if (!/^https?:\/\//i.test(configured)) {
    throw new Error('后台请求地址必须以 http:// 或 https:// 开头')
  }
  return configured.replace(/\/+$/, '')
}

export function backendUrl(path: string, configuredBaseUrl?: string): string {
  return `${resolveBackendApiBaseUrl(configuredBaseUrl)}/${path.replace(/^\/+/, '')}`
}
