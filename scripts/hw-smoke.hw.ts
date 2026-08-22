/**
 * 硬件冒烟测试：用真实串口（默认 COM3@9600）验证 jbd-bus / jbd-reg-io 完整链路。
 *
 * 运行：pnpm hw:smoke   （可传环境变量 PORT/BAUD 覆盖，如 PORT=COM5 pnpm hw:smoke）
 * 说明：文件名用 .hw.ts 而非 .test.ts —— 默认 `pnpm test`（CI）不会收集本文件，
 * 仅通过 vitest.hw.config.ts 显式指定时运行，避免无硬件环境（CI）误跑失败。
 *
 * 覆盖的链路 = 渲染层重构的全部代码路径：
 *   串口字节 → JbdSession 切帧 → jbdBus 分发 → sendAck 按命令码配对 → readRegs/readRegMap 解析
 * 仅做读操作 + 工厂模式标准进出（与「读取全部」一致），不下发任何参数值。
 *
 * 注意：需独占串口，运行时请先关闭正在使用该串口的 Electron 应用。
 */
import { it, expect } from 'vitest'
import { SerialPort } from 'serialport'
import { jbdBus } from '../src/jbd/jbd-bus'
import {
  buildReadBasicInfo, buildReadCellVoltages, buildReadChipType,
  parseBasicInfo, parseCellVoltages, toHex,
} from '../src/jbd/jbd-protocol'
import { readRegRaw, readRegMap, enterFactory, exitFactory } from '../src/jbd/jbd-reg-io'
import { CHIP_TYPES, paramRawToDisplay } from '../src/jbd/jbd-params'

const PORT = process.env.PORT || 'COM3'
const BAUD = Number(process.env.BAUD || 9600)

const results: { name: string; ok: boolean; detail: string }[] = []
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
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

function closePort(port: SerialPort): Promise<void> {
  return new Promise((resolve) => port.close(() => resolve()))
}

it(`COM3 真机链路冒烟（${PORT}@${BAUD}）`, { timeout: 60_000 }, async () => {
  console.log(`\n== 打开 ${PORT}@${BAUD}，开始链路冒烟 ==\n`)
  const port = await openPort()
  // 串口字节 → 帧总线（与 App.vue onData → jbdBus.feed 相同接线）
  port.on('data', (buf: Buffer) => {
    console.log(`  ← recv ${toHex(Array.from(buf))}`)
    jbdBus.feed(Array.from(buf))
  })
  // 帧总线 → 串口（与 App.vue jbdBus.setSender(handleSend) 相同接线）
  jbdBus.setSender((frame) => {
    console.log(`  → send ${toHex(frame)}`)
    port.write(Buffer.from(frame), (werr) => {
      if (werr) console.error('  写串口失败:', werr.message)
    })
  })
  jbdBus.setConnected(true)

  try {
    // 1. 芯片类型（首帧丢弃重试，与 useJbd.readChip 同策略）
    let chip: number | null = null
    for (let i = 0; i < 3 && chip === null; i++) {
      const f = await jbdBus.sendAck(buildReadChipType())
      if (!f.timeout && f.valid && f.status === 0x00 && f.data.length) {
        chip = f.data[f.data.length - 1]
      } else {
        await new Promise((r) => setTimeout(r, 400))
      }
    }
    record('读取芯片类型 (0x00)',
      chip !== null,
      chip !== null ? `${CHIP_TYPES[chip] ?? '未知方案'} (0x${chip.toString(16)})` : '3 次重试均无应答')

    // 2. 基本信息
    const basic = await jbdBus.sendAck(buildReadBasicInfo())
    if (!basic.timeout && basic.valid && basic.status === 0x00) {
      const bi = parseBasicInfo(basic.data)
      record('读取基本信息 (0x03)', true,
        `总压 ${(bi.totalVoltage_mV / 1000).toFixed(2)}V · 电流 ${(bi.current_mA / 1000).toFixed(2)}A · ` +
        `SOC ${bi.rsoc}% · ${bi.cellCount} 串 · ${bi.ntcCount} NTC · 版本 ${bi.swVersion}`)
    } else {
      record('读取基本信息 (0x03)', false, `timeout=${basic.timeout} valid=${basic.valid} status=0x${basic.status.toString(16)}`)
    }

    // 3. 单体电压
    const cells = await jbdBus.sendAck(buildReadCellVoltages())
    if (!cells.timeout && cells.valid && cells.status === 0x00) {
      const v = parseCellVoltages(cells.data)
      record('读单体电压 (0x04)', v.length > 0,
        `${v.length} 节 · 最低 ${(Math.min(...v) / 1000).toFixed(3)}V · 最高 ${(Math.max(...v) / 1000).toFixed(3)}V`)
    } else {
      record('读单体电压 (0x04)', false, `timeout=${cells.timeout} valid=${cells.valid}`)
    }

    // 4. 批量读（重构路径：readRegMap 连续段 + reg/count 一致性校验）
    const batch = await readRegMap(0, 11) // 寄存器 0~10：容量/电压/日期/序列号等
    if (batch) {
      record('批量读寄存器 0~10 (readRegMap)', Object.keys(batch).length === 11,
        `标称容量 ${paramRawToDisplay(0, batch[0])}Ah · 置满 ${paramRawToDisplay(2, batch[2])}mV · 置空 ${paramRawToDisplay(3, batch[3])}mV`)
    } else {
      record('批量读寄存器 0~10 (readRegMap)', false, '超时或 reg/count 校验不一致')
    }

    // 5. 单寄存器读（重构路径：readRegRaw）
    const shunt = await readRegRaw(28)
    record('单读寄存器 28 检流电阻 (readRegRaw)', shunt !== null,
      shunt !== null ? `${paramRawToDisplay(28, shunt)} mΩ (raw 0x${shunt.toString(16)})` : '超时')

    // 6. 工厂模式标准进出 + scd 寄存器读（与「读取全部」一致，不写任何参数）
    if (await enterFactory()) {
      const scd = await readRegRaw(40)
      record('工厂模式进出 + 读 scd 寄存器 40', scd !== null,
        scd !== null ? `二级过流 raw 0x${scd.toString(16).toUpperCase()} (level=${(scd >> 4) & 0xf}, delay=${scd & 0xf})` : '读取超时')
      record('退出工厂模式', await exitFactory(), '')
    } else {
      record('工厂模式进出 + 读 scd 寄存器 40', false, '进入工厂模式失败')
    }
  } finally {
    jbdBus.setConnected(false)
    jbdBus.clear()
    await closePort(port)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n== 结果：${results.length - failed.length}/${results.length} 通过 ==`)
  if (failed.length) {
    throw new Error(`硬件冒烟存在失败项: ${failed.map((f) => f.name).join('; ')}`)
  }
  expect(failed.length).toBe(0)
})
