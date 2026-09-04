import test from 'node:test'
import assert from 'node:assert/strict'
import { canDispatchParameters, isAuthSessionValid, loginBackend } from '../src/auth/auth.ts'

test('login sends only user-editable fields and returns backend session', async () => {
  let requestedUrl = ''
  let requestMethod = ''
  let contentType = ''
  let requestBody = ''
  const session = await loginBackend('admin', 'Admin@123', async (url, init) => {
    requestedUrl = url
    requestMethod = init.method
    contentType = init.headers['Content-Type']
    requestBody = init.body
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        msg: '',
        data: { userId: 1, accessToken: 'token', refreshToken: 'refresh', expiresTime: 1788674764557 },
      }),
    }
  })

  assert.equal(requestedUrl, 'https://ty.chuanaitec.cn/admin-api/system/auth/login')
  assert.equal(requestMethod, 'POST')
  assert.equal(contentType, 'application/json')
  assert.deepEqual(JSON.parse(requestBody), {
    tenantName: '',
    username: 'admin',
    password: 'Admin@123',
    rememberMe: true,
  })
  assert.deepEqual(session, {
    userId: 1,
    username: 'admin',
    accessToken: 'token',
    expiresTime: 1788674764557,
  })
})

test('backend business failure rejects login', async () => {
  await assert.rejects(
    () => loginBackend('admin', 'wrong', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 400, msg: '用户不存在', data: null }),
    })),
    /用户不存在/,
  )
})

test('login request is abortable', async () => {
  let requestSignal: AbortSignal | undefined
  const pending = loginBackend('admin', 'Admin@123', async (_url, init) => {
    requestSignal = init.signal
    return new Promise((_resolve, reject) => {
      requestSignal!.addEventListener('abort', () => reject(new Error('request aborted')))
    })
  })

  for (let i = 0; i < 20 && !requestSignal; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.ok(requestSignal)
  requestSignal!.dispatchEvent(new Event('abort'))
  await assert.rejects(() => pending, /无法连接登录服务/)
})

test('parameter dispatch requires a connection and an unexpired login', () => {
  const now = 1000
  const session = { userId: 1, username: 'admin', accessToken: 'token', expiresTime: 2000 }

  assert.equal(isAuthSessionValid(session, now), true)
  assert.equal(canDispatchParameters(true, session, now), true)
  assert.equal(canDispatchParameters(false, session, now), false)
  assert.equal(canDispatchParameters(true, null, now), false)
  assert.equal(canDispatchParameters(true, { ...session, expiresTime: now }, now), false)
})
