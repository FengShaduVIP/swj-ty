import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDispatchSnapshot,
  isDispatchUploadRecord,
  shouldUploadDispatchRecord,
  shouldUploadDispatchResult,
} from '../src/dispatch/uploadDecision.ts'
import { uploadDispatchRecord } from '../src/auth/dispatchUpload.ts'

test('only V3-- Bluetooth names are eligible for backend upload', () => {
  assert.equal(shouldUploadDispatchRecord('V3--F82064'), true)
  assert.equal(shouldUploadDispatchRecord('v3--F82064'), false)
  assert.equal(shouldUploadDispatchRecord('V3-F82064'), false)
  assert.equal(shouldUploadDispatchRecord(''), false)
})

test('dispatch snapshot keeps known writable parameters and drops unavailable rows', () => {
  const params = buildDispatchSnapshot([
    { label: '额定充电电压', index: 117, value: 58, readOnly: false },
    { label: '只读参数', index: 0, value: 100, readOnly: true },
    { label: '未读取参数', index: 10, value: null, readOnly: false },
    { label: '充电均衡', bitIndex: 29, value: true, readOnly: false },
    { label: '无寄存器参数', value: 1, readOnly: false },
  ])

  assert.deepEqual(params, [
    { label: '额定充电电压', index: 117, value: 58 },
    { label: '充电均衡', index: 29, value: true },
  ])
})

test('partial dispatch success still uploads, total failure does not', () => {
  assert.equal(shouldUploadDispatchResult({ ok: 2, fail: 1 }), true)
  assert.equal(shouldUploadDispatchResult({ ok: 0, fail: 3 }), false)
})

test('dispatch upload records are validated before crossing IPC', () => {
  assert.equal(isDispatchUploadRecord({
    btName: 'V3--F82064',
    dispatchedAt: 1788674764557,
    params: [{ label: '参数', index: 1, value: 2 }],
  }), true)
  assert.equal(isDispatchUploadRecord({
    btName: 'V3--F82064',
    dispatchedAt: '1788674764557',
    params: [{ label: '参数', index: 1, value: 2 }],
  }), false)
  assert.equal(isDispatchUploadRecord({
    btName: 'V3--F82064',
    dispatchedAt: 1788674764557,
    params: [{ index: 1, value: 2 }],
  }), false)
  assert.equal(isDispatchUploadRecord(null), false)
})

test('dispatch upload sends the snapshot with the access token', async () => {
  let requestedUrl = ''
  let requestMethod = ''
  let authorization = ''
  let requestBody = ''
  const record = {
    btName: 'V3--F82064',
    dispatchedAt: 1788674764557,
    params: [{ label: '额定充电电压', index: 117, value: 58 }],
  }

  await uploadDispatchRecord(record, 'access-token', async (url, init) => {
    requestedUrl = url
    requestMethod = init.method
    authorization = init.headers.Authorization
    requestBody = init.body
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 200, msg: '', data: true }),
    }
  })

  assert.equal(requestedUrl, 'https://ty.chuanaitec.cn/admin-api/iot/bms-param-dispatch-latest/upload')
  assert.equal(requestMethod, 'POST')
  assert.equal(authorization, 'Bearer access-token')
  assert.equal(requestBody, JSON.stringify(record))
})

test('dispatch upload rejects backend business failures', async () => {
  await assert.rejects(
    () => uploadDispatchRecord({
      btName: 'V3--F82064',
      dispatchedAt: 1788674764557,
      params: [{ label: '参数', index: 1, value: 2 }],
    }, 'token', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 400, msg: '蓝牙名称必须以 V3-- 开头', data: null }),
    })),
    /蓝牙名称必须以 V3-- 开头/,
  )
})

test('dispatch upload request is abortable', async () => {
  let requestSignal: AbortSignal | undefined
  const pending = uploadDispatchRecord({
    btName: 'V3--F82064',
    dispatchedAt: 1788674764557,
    params: [{ label: '参数', index: 1, value: 2 }],
  }, 'token', async (_url, init) => {
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
  await assert.rejects(() => pending, /无法上传下发记录/)
})
