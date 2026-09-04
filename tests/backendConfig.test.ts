import test from 'node:test'
import assert from 'node:assert/strict'
import { backendUrl, resolveBackendApiBaseUrl } from '../src/auth/backendConfig.ts'

test('backend API base URL defaults to the production admin API', () => {
  assert.equal(resolveBackendApiBaseUrl(), 'https://ty.chuanaitec.cn/admin-api')
  assert.equal(backendUrl('/system/auth/login'), 'https://ty.chuanaitec.cn/admin-api/system/auth/login')
})

test('backend API base URL can be configured by VITE_API_BASE_URL', () => {
  const configured = 'http://127.0.0.1:48080/admin-api/'
  assert.equal(resolveBackendApiBaseUrl(configured), 'http://127.0.0.1:48080/admin-api')
  assert.equal(
    backendUrl('/iot/bms-param-dispatch-latest/upload', configured),
    'http://127.0.0.1:48080/admin-api/iot/bms-param-dispatch-latest/upload',
  )
})

test('backend API base URL must be http or https', () => {
  assert.throws(
    () => resolveBackendApiBaseUrl('file://ty.chuanaitec.cn'),
    /后台请求地址必须以 http:\/\/ 或 https:\/\/ 开头/,
  )
})
