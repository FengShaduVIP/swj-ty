export interface DispatchUploadParam {
  label: string
  index?: number
  value: unknown
}

export interface DispatchUploadRecord {
  btName: string
  dispatchedAt: number
  params: DispatchUploadParam[]
}

interface SnapshotField {
  label: string
  index?: number
  bitIndex?: number
  value: unknown
  readOnly?: boolean
}

export function shouldUploadDispatchRecord(btName: string): boolean {
  return typeof btName === 'string' && btName.startsWith('V3--')
}

export function shouldUploadDispatchResult(result: { ok: number; fail: number }): boolean {
  return result.ok > 0
}

export function buildDispatchSnapshot(fields: SnapshotField[]): DispatchUploadParam[] {
  return fields
    .filter((field) => !field.readOnly && field.value !== null && field.value !== undefined)
    .filter((field) => field.index !== undefined || field.bitIndex !== undefined)
    .map((field) => {
      const param: DispatchUploadParam = {
        label: field.label,
        value: field.value,
      }
      const index = field.index ?? field.bitIndex
      if (index !== undefined) param.index = index
      return param
    })
}

export function isDispatchUploadRecord(value: unknown): value is DispatchUploadRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<DispatchUploadRecord>
  return (
    typeof record.btName === 'string' &&
    !!record.btName &&
    typeof record.dispatchedAt === 'number' &&
    Number.isFinite(record.dispatchedAt) &&
    Array.isArray(record.params) &&
    record.params.every((param) => (
      !!param &&
      typeof param.label === 'string' &&
      !!param.label &&
      (param.index === undefined || (typeof param.index === 'number' && Number.isInteger(param.index) && param.index >= 0)) &&
      param.value !== undefined &&
      param.value !== null
    ))
  )
}
