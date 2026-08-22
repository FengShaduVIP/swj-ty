/**
 * 硬件诊断：只读扫描寄存器 0~231，定位「电池SN码」等 ASCII 字符串的真实存储位置。
 *
 * 背景：对齐标准上位机显示名（图1）时发现 —— 标准工具的「电池SN码」显示 ASCII 文本
 * （如 V3--12345），而本项目按寄存器 6 数值以十六进制展示（0x0000）。为确定 SN 字符串
 * 到底存放在哪个寄存器块，全量只读扫描并找出所有可打印字符串段。
 *
 * 运行：pnpm vitest run --config vitest.hw.config.ts scripts/hw-scan.hw.ts
 * 说明：只做读操作 + 工厂模式标准进出，不写任何寄存器；需独占串口。
 */
import { it, expect } from 'vitest'
import { SerialPort } from 'serialport'
import { mkdirSync, writeFileSync } from 'node:fs'
import { jbdBus } from '../src/jbd/jbd-bus'
import { buildReadBasicInfo, buildReadChipType, parseBasicInfo } from '../src/jbd/jbd-protocol'
import { readRegMap, readRegs, enterFactory, exitFactory, decodeAsciiBytes } from '../src/jbd/jbd-reg-io'

const PORT = process.env.PORT || 'COM3'
const BAUD = Number(process.env.BAUD || 9600)

const SCAN_HI = 231 // 寄存器 0~231（覆盖协议已定义 + 预留区）

// 输出同时落盘 test-reports/hw-scan-<时间戳>.log（测试数据本地留档）
const logLines: string[] = []
function log(msg: string) {
  console.log(msg)
  logLines.push(msg)
}
function saveReport() {
  try {
    mkdirSync('test-reports', { recursive: true })
    const name = `test-reports/hw-scan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
    writeFileSync(name, logLines.join('\n') + '\n', 'utf-8')
    console.log(`报告已保存: ${name}`)
  } catch (e) {
    console.log('报告保存失败:', (e as Error).message)
  }
}

function openPort(): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: PORT, baudRate: BAUD, autoOpen: false })
    port.open((err) => (err ? reject(err) : resolve(port)))
  })
}
function closePort(port: SerialPort): Promise<void> {
  return new Promise((resolve) => port.close(() => resolve()))
}
const hex = (v: number) => v.toString(16).toUpperCase().padStart(4, '0')

it(`COM3 寄存器只读扫描（${PORT}@${BAUD}）`, { timeout: 180_000 }, async () => {
  log(`\n== 打开 ${PORT}@${BAUD}，只读扫描寄存器 0~${SCAN_HI} ==\n`)
  const port = await openPort()
  port.on('data', (buf: Buffer) => jbdBus.feed(Array.from(buf)))
  jbdBus.setSender((frame) => port.write(Buffer.from(frame)))
  jbdBus.setConnected(true)

  try {
    // 基本信息（拿 swVersion 原始字节，用于对照「BMS版本号」）
    const basic = await jbdBus.sendAck(buildReadBasicInfo())
    if (!basic.timeout && basic.valid && basic.status === 0x00) {
      const bi = parseBasicInfo(basic.data)
      log(`基本信息: swVersion=${bi.swVersion}（标准上位机显示 ${bi.swVersion.replace('.', '')}）`)
    }
    const chipFrame = await jbdBus.sendAck(buildReadChipType())
    if (!chipFrame.timeout && chipFrame.valid && chipFrame.data.length) {
      log(`芯片类型: 0x${chipFrame.data[chipFrame.data.length - 1].toString(16)}`)
    }

    if (!(await enterFactory())) throw new Error('进入工厂模式失败')
    log('已进入工厂模式，开始扫描…')

    // 分段批量读（单帧上限 ~48 寄存器）
    const map: Record<number, number> = {}
    for (let lo = 0; lo <= SCAN_HI; lo += 44) {
      const hi = Math.min(lo + 43, SCAN_HI)
      const part = await readRegMap(lo, hi - lo + 1)
      if (part) Object.assign(map, part)
      else log(`  段 ${lo}~${hi} 读取失败（超时/校验不一致）`)
    }
    log(`共读到 ${Object.keys(map).length} 个寄存器\n`)

    // 1) 已知 ASCII 块（[len][string] 约定）逐一解码。
    //    注意：必须用 readRegs(start,16) 单块读（与页面 readField 同源）——
    //    大跨度批量读（readRegMap 跨块）实测会让设备返回字节序错位的 ASCII 块。
    console.log('== 已知 ASCII 块解码 ==')
    for (const start of [6, 56, 72, 88, 158, 176]) {
      const r = await readRegs(start, 16)
      if (!r) { log(`块 ${start}~${start + 15}: 读取失败`); continue }
      const flat = r.values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff])
      const text = decodeAsciiBytes(flat)
      log(`块 ${start}~${start + 15}: raw[${r.values.slice(0, 6).map(hex).join(' ')}…] → 「${text}」`)
    }

    // 2) 全范围找可打印 ASCII 连续段（≥4 个可见字符），定位未知字符串存储位置
    log('\n== 可打印字符串段（≥4 字符） ==')
    const bytes: { r: number; b: number }[] = []
    for (let r = 0; r <= SCAN_HI; r++) {
      const v = map[r]
      if (v === undefined) { bytes.push({ r, b: -1 }); bytes.push({ r, b: -1 }) } 
      else { bytes.push({ r, b: (v >> 8) & 0xff }); bytes.push({ r, b: v & 0xff }) }
    }
    let run = ''
    let runStartReg = -1
    const flush = () => {
      if (run.length >= 4) log(`  寄存器 ${runStartReg} 起: 「${run}」`)
      run = ''
    }
    for (const { r, b } of bytes) {
      if (b >= 0x20 && b <= 0x7e) {
        if (!run) runStartReg = r
        run += String.fromCharCode(b)
      } else flush()
    }
    flush()

    log('\n== 退出工厂模式 ==')
    expect(await exitFactory()).toBe(true)
    saveReport()
  } finally {
    jbdBus.setConnected(false)
    jbdBus.clear()
    await closePort(port)
  }
})
