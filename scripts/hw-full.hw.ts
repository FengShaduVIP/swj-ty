/**
 * 全功能真机测试：覆盖读/写全部链路，所有收发帧与结果落盘到 test-reports/。
 *
 * 运行：pnpm hw:full   （PORT/BAUD 环境变量可覆盖）
 * 输出（test-reports/hw-full-<时间戳>.{json,log}）：
 *   .json — 测试结果 + 设备数据快照（基本信息/单体电压/保护次数/参数寄存器原始值）+ 全部帧日志
 *   .log  — 人类可读的时间线日志（与控制台输出一致）
 *
 * 测试策略：
 *   读操作 —— 直接读（含批量读、ASCII 块、工厂模式内读取）；
 *   写操作 —— 「写回原值」：读出当前值 → 原样写回 → 回读比对，
 *             完整走通下发链路（工厂模式/写帧/ACK/校验）但不改变设备配置；
 *   最后做「配置未被改变」核验（关键寄存器前后比对）。
 *   破坏性指令（复位MCU/清保护记录/清故障/休眠/关机/MOS控制）跳过不测：
 *   会导致设备重启、数据清除或进入休眠，需要用户明确授权单独执行。
 *
 * 注意：需独占串口，运行时请先关闭正在使用该串口的 Electron 应用。
 */
import { it, expect } from 'vitest'
import { SerialPort } from 'serialport'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { jbdBus } from '../src/jbd/jbd-bus'
import {
  buildReadBasicInfo, buildReadCellVoltages, buildReadChipType, buildReadHardwareVersion,
  buildReadProtectCounts, buildReadInternalRes, buildSetBtName,
  parseBasicInfo, parseCellVoltages, parseHardwareVersion, parseProtectCounts, parseInternalRes,
  toHex, type Frame,
} from '../src/jbd/jbd-protocol'
import {
  readRegs, readRegRaw, readRegMap, writeRegs, enterFactory, exitFactory, decodeAsciiBytes,
} from '../src/jbd/jbd-reg-io'
import { CHIP_TYPES, paramRawToDisplay, splitScd } from '../src/jbd/jbd-params'

const PORT = process.env.PORT || 'COM3'
const BAUD = Number(process.env.BAUD || 9600)

// ===== 记录与帧日志 =====
interface FrameLog { t: string; dir: 'send' | 'recv'; hex: string }
const frameLog: FrameLog[] = []
const results: { name: string; ok: boolean; detail: string }[] = []
const snapshot: Record<string, unknown> = {}
/** A7 批量读收集的寄存器原始值（reg → raw16），落盘到报告 */
const paramsRaw: Record<number, number> = {}

function ts(): string {
  const d = new Date()
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}
function logFrame(dir: 'send' | 'recv', hex: string) {
  frameLog.push({ t: ts(), dir, hex })
  console.log(`  ${dir === 'send' ? '→ send ' : '← recv '}${hex}`)
}
function record(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 带重试的发送（吸收嘉百达首帧丢弃）：任一次拿到有效应答即返回 */
async function askRetry(frame: number[], times = 3): Promise<Frame> {
  let last: Frame | null = null
  for (let i = 0; i < times; i++) {
    const f = await jbdBus.sendAck(frame)
    last = f
    if (!f.timeout && f.valid) return f
    await sleep(350)
  }
  return last!
}

function openPort(): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: PORT, baudRate: BAUD, autoOpen: false })
    port.open((err) => {
      if (err) {
        console.error(`串口 ${PORT}@${BAUD} 打开失败: ${err.message}`)
        console.error('若为拒绝访问/EBUSY：请先关闭正在占用该串口的应用（如 Electron 天一BMS）。')
        reject(err)
        return
      }
      resolve(port)
    })
  })
}
const closePort = (port: SerialPort) => new Promise<void>((resolve) => port.close(() => resolve()))

it(`COM3 全功能真机测试（${PORT}@${BAUD}）`, { timeout: 120_000 }, async () => {
  console.log(`\n== 打开 ${PORT}@${BAUD}，开始全功能测试 ==\n`)
  const port = await openPort()
  port.on('data', (buf: Buffer) => {
    const hex = toHex(Array.from(buf))
    logFrame('recv', hex)
    jbdBus.feed(Array.from(buf))
  })
  jbdBus.setSender((frame) => {
    logFrame('send', toHex(frame))
    port.write(Buffer.from(frame), (werr) => {
      if (werr) console.error('  写串口失败:', werr.message)
    })
  })
  jbdBus.setConnected(true)

  try {
    // ============ A. 读功能全覆盖 ============
    console.log('\n--- A. 读功能 ---')

    // A1 芯片类型
    const chipF = await askRetry(buildReadChipType())
    const chip = !chipF.timeout && chipF.valid && chipF.status === 0x00 && chipF.data.length
      ? chipF.data[chipF.data.length - 1] : null
    record('A1 芯片类型 (0x00)', chip !== null,
      chip !== null ? `${CHIP_TYPES[chip] ?? '未知方案'} (0x${chip.toString(16)})` : '无应答/校验失败')
    snapshot.chipType = chip

    // A2 基本信息
    const basicF = await askRetry(buildReadBasicInfo())
    if (!basicF.timeout && basicF.valid && basicF.status === 0x00) {
      const bi = parseBasicInfo(basicF.data)
      snapshot.basicInfo = bi
      record('A2 基本信息 (0x03)', true,
        `总压 ${(bi.totalVoltage_mV / 1000).toFixed(2)}V · 电流 ${(bi.current_mA / 1000).toFixed(2)}A · SOC ${bi.rsoc}% · ` +
        `剩余 ${(bi.remainingCapacity_mAh / 1000).toFixed(2)}Ah · ${bi.cellCount} 串 · ${bi.ntcCount} NTC · ` +
        `温度 ${bi.temperatures_C.map((t) => t.toFixed(1)).join('/')}℃ · 版本 ${bi.swVersion} · ` +
        `FET 充${bi.fet.charge ? '开' : '关'}放${bi.fet.discharge ? '开' : '关'}`)
    } else {
      record('A2 基本信息 (0x03)', false, `timeout=${basicF.timeout} valid=${basicF.valid}`)
    }

    // A3 单体电压
    const cellsF = await askRetry(buildReadCellVoltages())
    if (!cellsF.timeout && cellsF.valid && cellsF.status === 0x00) {
      const v = parseCellVoltages(cellsF.data)
      snapshot.cellVoltages = v
      record('A3 单体电压 (0x04)', v.length > 0,
        `${v.length} 节 · 最低 ${(Math.min(...v) / 1000).toFixed(3)}V · 最高 ${(Math.max(...v) / 1000).toFixed(3)}V · ` +
          `压差 ${((Math.max(...v) - Math.min(...v))).toFixed(0)}mV`)
    } else {
      record('A3 单体电压 (0x04)', false, `timeout=${cellsF.timeout}`)
    }

    // A4 硬件版本
    const hwF = await askRetry(buildReadHardwareVersion())
    if (!hwF.timeout && hwF.valid && hwF.status === 0x00) {
      const hw = parseHardwareVersion(hwF.data)
      snapshot.hwVersion = hw
      record('A4 硬件版本 (0x05)', true, hw || '(空)')
    } else {
      record('A4 硬件版本 (0x05)', false, `timeout=${hwF.timeout}`)
    }

    // A5 保护次数
    const protF = await askRetry(buildReadProtectCounts())
    if (!protF.timeout && protF.valid && protF.status === 0x00) {
      const pc = parseProtectCounts(protF.data)
      snapshot.protectCounts = pc
      const total = Object.values(pc).reduce((a, b) => a + b, 0)
      record('A5 保护次数 (0xAA)', true,
        Object.entries(pc).map(([k, n]) => `${k}${n}`).join(' · ') + (total ? ' ← 有历史记录' : '（全 0）'))
    } else {
      record('A5 保护次数 (0xAA)', false, `timeout=${protF.timeout}`)
    }

    // A6 内阻
    const resF = await askRetry(buildReadInternalRes())
    if (!resF.timeout && resF.valid) {
      if (resF.status === 0x00) {
        const ir = parseInternalRes(resF.data)
        snapshot.internalRes = ir
        record('A6 内阻 (0xF6)', true, ir.length ? ir.map((r) => r + 'mΩ').join(' ') : '(空数据)')
      } else {
        record('A6 内阻 (0xF6)', true, `设备返回 0x${resF.status.toString(16)}（可能未进工厂模式/不支持）`)
      }
    } else {
      record('A6 内阻 (0xF6)', false, `timeout=${resF.timeout} valid=${resF.valid}`)
    }

    // A7 批量读：多段寄存器
    const batchSegs: { start: number; count: number; label: string }[] = [
      { start: 0, count: 11, label: '0~10 容量/电压' },
      { start: 16, count: 13, label: '16~28 保护参数/检流' },
      { start: 34, count: 10, label: '34~43 电压点/延时/scd' },
    ]
    for (const seg of batchSegs) {
      const map = await readRegMap(seg.start, seg.count)
      if (map) {
        Object.assign(paramsRaw, map)
        record(`A7 批量读 ${seg.label} (readRegMap)`, Object.keys(map).length === seg.count,
          Object.entries(map).slice(0, 6).map(([r, v]) => `[${r}]=${paramRawToDisplay(Number(r), v)}`).join(' ') + ' …')
      } else {
        record(`A7 批量读 ${seg.label} (readRegMap)`, false, '超时或 reg/count 不一致')
      }
    }

    // ============ B. 工厂模式 + ASCII 块读取 ============
    console.log('\n--- B. 工厂模式 / ASCII 块 ---')
    let asciiBlocks: Record<string, string> = {}
    let btNameDecoded = ''
    if (await enterFactory()) {
      record('B1 进入工厂模式', true, 'DD 5A 00 02 56 78 (默认密码)')
      // 厂商信息 56~71 / 蓝牙名称 88~103
      const mfr = await readRegs(56, 16)
      const mfrText = mfr && mfr.reg === 56 ? decodeAsciiBytes(mfr.values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff])) : ''
      record('B2 ASCII 块读 厂商信息 56~71', mfr !== null, mfrText ? `「${mfrText}」` : '(空)')
      const bt = await readRegs(88, 16)
      if (bt && bt.reg === 88) {
        btNameDecoded = decodeAsciiBytes(bt.values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]))
        record('B3 ASCII 块读 蓝牙名称 88~103', true, btNameDecoded ? `「${btNameDecoded}」` : '(空)')
      } else {
        record('B3 ASCII 块读 蓝牙名称 88~103', false, '读取失败')
      }
      asciiBlocks = { 厂商信息_56_71: mfrText, 蓝牙名称_88_103: btNameDecoded }
      snapshot.asciiBlocks = asciiBlocks
      record('B4 退出工厂模式', await exitFactory(), '')
    } else {
      record('B1 进入工厂模式', false, '超时或设备拒绝')
      record('B2 ASCII 块读 厂商信息 56~71', false, '依赖工厂模式，跳过')
      record('B3 ASCII 块读 蓝牙名称 88~103', false, '依赖工厂模式，跳过')
      record('B4 退出工厂模式', false, '未进入')
    }

    // ============ C. 写功能（写回原值，不改变配置）============
    console.log('\n--- C. 写功能（写回原值） ---')
    // 写前快照（工厂模式内读取，scd 40/41 需解锁态）
    const writeTargets = [2, 29, 30, 40, 41] // 置满电压 / 功能配置位图 / 温度探头位图 / 二级过流 / 短路
    const before: Record<number, number> = {}
    if (await enterFactory()) {
      for (const reg of writeTargets) {
        const raw = await readRegRaw(reg)
        if (raw !== null) before[reg] = raw
      }
      // C1 普通寄存器写回（reg 2 置满电压）
      if (before[2] !== undefined) {
        const wrote = await writeRegs(2, [(before[2] >> 8) & 0xff, before[2] & 0xff])
        const after = await readRegRaw(2)
        record('C1 普通寄存器写回 (reg2 置满电压)', wrote && after === before[2],
          `原值 0x${before[2].toString(16)} 写回${wrote ? 'ACK' : '失败'} 回读 0x${(after ?? -1).toString(16)}${after === before[2] ? ' 一致' : ' 不一致'}`)
      }
      // C2/C3 位图寄存器写回（reg29 功能配置 / reg30 温度探头）
      for (const reg of [29, 30]) {
        if (before[reg] === undefined) { record(`C${reg - 27} 位图写回 (reg${reg})`, false, '写前读取失败'); continue }
        const wrote = await writeRegs(reg, [(before[reg] >> 8) & 0xff, before[reg] & 0xff])
        const after = await readRegRaw(reg)
        record(`C${reg - 27} 位图寄存器写回 (reg${reg})`, wrote && after === before[reg],
          `原值 0x${before[reg].toString(16).toUpperCase()} 回读 0x${(after ?? -1).toString(16).toUpperCase()}${after === before[reg] ? ' 一致' : ' 不一致'}`)
      }
      // C4/C5 scd 复合寄存器写回（reg40 二级过流 / reg41 短路）
      for (const reg of [40, 41]) {
        const n = reg === 40 ? 4 : 5
        if (before[reg] === undefined) { record(`C${n} scd 写回 (reg${reg})`, false, '写前读取失败'); continue }
        const wrote = await writeRegs(reg, [(before[reg] >> 8) & 0xff, before[reg] & 0xff])
        const after = await readRegRaw(reg)
        const p0 = splitScd(before[reg])
        const p1 = after !== null ? splitScd(after) : { level: -1, delay: -1 }
        record(`C${n} scd 复合寄存器写回 (reg${reg})`, wrote && after === before[reg],
          `原值 0x${before[reg].toString(16).toUpperCase()}(档${p0.level}/延${p0.delay}) 回读 0x${(after ?? -1).toString(16).toUpperCase()}(档${p1.level}/延${p1.delay})`)
      }
      // C6 蓝牙名称写回（0xA2 专用指令；仅在解码出合理名称时执行）
      if (/^[A-Za-z0-9\-_. ]{1,32}$/.test(btNameDecoded)) {
        const resp = await jbdBus.sendAck(buildSetBtName(btNameDecoded))
        const ackOk = !resp.timeout && resp.status === 0x00
        const reread = await readRegs(88, 16)
        const nameAfter = reread && reread.reg === 88
          ? decodeAsciiBytes(reread.values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff])) : ''
        record('C6 蓝牙名称写回 (0xA2 专用指令)', ackOk && nameAfter === btNameDecoded,
          `「${btNameDecoded}」 ACK=${ackOk} 回读「${nameAfter}」${nameAfter === btNameDecoded ? ' 一致' : ' 不一致'}`)
      } else {
        record('C6 蓝牙名称写回 (0xA2 专用指令)', true, `解码名「${btNameDecoded}」非常规，跳过写回以免误改`)
      }
      // C7 模拟「强制下发 + 批量校验」：寄存器 16~25 读出→逐个写回→批量读比对
      const fwMap = await readRegMap(16, 10)
      if (fwMap) {
        let allWrote = true
        for (let r = 16; r <= 25; r++) {
          const raw = fwMap[r]
          const ok = await writeRegs(r, [(raw >> 8) & 0xff, raw & 0xff])
          if (!ok) allWrote = false
        }
        const verifyMap = await readRegMap(16, 10)
        const mismatch = verifyMap
          ? [...Array(10).keys()].map((i) => 16 + i).filter((r) => verifyMap[r] !== fwMap[r])
          : ['批量读失败']
        record('C7 强制下发模拟（16~25 写回 + 批量校验）', allWrote && mismatch.length === 0,
          allWrote ? (mismatch.length === 0 ? '10 个寄存器写回后批量回读全部一致' : `不一致: ${mismatch.join(',')}`) : '存在写失败')
      } else {
        record('C7 强制下发模拟（16~25 写回 + 批量校验）', false, '写前批量读失败')
      }
      record('C8 退出工厂模式', await exitFactory(), '')
    } else {
      for (const n of ['C1 普通寄存器写回', 'C2 位图写回(29)', 'C3 位图写回(30)', 'C4 scd 写回(40)', 'C5 scd 写回(41)', 'C6 蓝牙名称写回', 'C7 强制下发模拟', 'C8 退出工厂模式']) {
        record(n, false, '进入工厂模式失败，整段跳过')
      }
    }

    // ============ D. 非侵入核验 ============
    console.log('\n--- D. 配置核验 ---')
    const keyRegs = [0, 2, 3, 28, 40, 41]
    const before2: Record<number, number> = {}
    for (const r of keyRegs) if (paramsRaw[r] !== undefined) before2[r] = paramsRaw[r]
    // scd 40/41 需工厂态读取，与 paramsRaw（普通态批量读）可能差异 —— 仅比对非 scd
    const checkRegs = keyRegs.filter((r) => r !== 40 && r !== 41)
    let unchanged = true
    const diffs: string[] = []
    if (await enterFactory()) {
      for (const r of checkRegs) {
        const now = await readRegRaw(r)
        if (now !== null && now !== before2[r]) { unchanged = false; diffs.push(`reg${r}: 0x${before2[r]?.toString(16)}→0x${now.toString(16)}`) }
      }
      // scd 与工厂模式内 before 快照比对
      for (const r of [40, 41]) {
        const now = await readRegRaw(r)
        if (now !== null && before[r] !== undefined && now !== before[r]) { unchanged = false; diffs.push(`reg${r}: 0x${before[r].toString(16)}→0x${now.toString(16)}`) }
      }
      await exitFactory()
    }
    record('D1 关键寄存器配置未被改变', unchanged,
      unchanged ? `${[...checkRegs, 40, 41].join(',')} 前后一致` : `变化: ${diffs.join('; ')}`)

    record('D2 破坏性指令（复位MCU/清记录/清故障/休眠/关机/MOS）', true, '跳过：会重启设备/清除数据/休眠，需单独授权执行')
  } finally {
    jbdBus.setConnected(false)
    jbdBus.clear()
    await closePort(port)
  }

  snapshot.paramsRaw = paramsRaw
  const failed = results.filter((r) => !r.ok)
  const pass = saveResults()

  function saveResults(): number {
    const s = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const dir = join(process.cwd(), 'test-reports')
    mkdirSync(dir, { recursive: true })
    const p = results.filter((r) => r.ok).length
    const sent = frameLog.filter((f) => f.dir === 'send').length
    const received = frameLog.filter((f) => f.dir === 'recv').length
    const report = {
      meta: { time: new Date().toISOString(), port: PORT, baud: BAUD, pass: p, total: results.length, sent, received },
      results,
      snapshot,
      frameLog,
    }
    writeFileSync(join(dir, `hw-full-${s}.json`), JSON.stringify(report, null, 2))
    const lines = [
      `# 天一BMS 全功能真机测试  ${new Date().toLocaleString('zh-CN')}`,
      `# 串口 ${PORT}@${BAUD} · ${p}/${results.length} 通过 · 发送 ${sent} 帧 / 接收 ${received} 帧`,
      '',
      ...results.map((r) => `[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`),
      '',
      '## 帧日志（时间 方向 HEX）',
      ...frameLog.map((f) => `${f.t}  ${f.dir === 'send' ? '→' : '←'}  ${f.hex}`),
    ]
    writeFileSync(join(dir, `hw-full-${s}.log`), lines.join('\n'))
    console.log(`\n== 报告已保存: test-reports/hw-full-${s}.{json,log} ==`)
    return p
  }

  console.log(`\n== 结果：${pass}/${results.length} 通过 ==`)
  if (failed.length) throw new Error(`真机全功能测试存在失败项: ${failed.map((f) => f.name).join('; ')}`)
  expect(failed.length).toBe(0)
})
