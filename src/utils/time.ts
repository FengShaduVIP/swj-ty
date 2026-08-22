/** 当前时间 HH:mm:ss.SSS（通信日志等高精度显示用） */
export function nowTimeWithMs(d = new Date()): string {
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.toLocaleTimeString('zh-CN', { hour12: false })}.${ms}`
}

/** 时间戳 → YYYY-MM-DD HH:mm[:ss]（本地时区） */
export function fmtDateTime(ts: number, withSeconds = true): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return withSeconds ? `${base}:${p(d.getSeconds())}` : base
}
