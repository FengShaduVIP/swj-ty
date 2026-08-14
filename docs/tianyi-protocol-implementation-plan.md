# 天一协议 (TIANYI / Modbus-RTU) 接入实现方案（并列独立页面版）

> 状态：方案稿 v2（已据用户选择调整为「并列独立页面」架构，待最终确认后编码）  
> 目标：`serial-modbus-tool` 在现有「嘉百达 JBD」之外，新增并列的「天一 TIANYI」协议（标准 Modbus-RTU）。  
> **JBD 三页与状态层完全冻结不改**；天一另起三页 + 状态层 + 适配器；共享「协议可插拔的串口总线 + 类型/CRC/Modbus 切帧/激活状态」。  
> 范围 v1：完整寄存器表（A0–AA，除 OTA）；**不含 OTA 固件升级**。



---

## 1. 需求复述与确认状态

**已确认决策（历史对话 + AskUserQuestion）：**

1. 天一协议 = 标准 Modbus-RTU（依据 `modbus协议寄存器映射表V7-4G专用V1.xlsx`）。
2. 经 USB 串口接入，与 JBD 同物理通道（复用现有 `electron/serial.ts`），不加蓝牙。
3. v1 含完整寄存器表（除 OTA），串口默认 9600/8N1/从机 0x01。
4. 执行节奏 = 先出详细方案再写代码。

**本方案已采纳的架构选择（你已拍板）：**

- **D1 监测页**：天一新建独立 `TianyiPanel.vue`，与 `JbdPanel.vue` 并列，不复用 `BasicInfo`。
- **D2 配置页**：JBD `JbdParamConfig.vue` 冻结保留；天一新建 `TianyiParamConfig.vue`（数据驱动，仅服务天一 `paramTable`）。
- **D3 控制页**：同理新建 `TianyiControl.vue`。
- **D4 共享层**：单一串口总线 `deviceBus`（由 `jbd-bus.ts` 演化，协议可插拔，保留 `jbdBus` 别名 + JBD 默认）；类型 / CRC16 / Modbus 切帧 / 激活状态 / 天一适配器为新增。

---

## 2. 信息完整性与待校准点（可能你未意识到的）

| #   | 项                | 处理                                                                                                                                                                   |                        |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| G4  | **文档换算错漏**       | `ec_hw` 地址错位（ec_hw8 重复、缺 ec_sw8）；`A024/A025` 名写"累计充电"但变量 `T_D_KWH`（放电）；`A709` HEX 地址列空白。所有 `offset/resolution/字节序` 在 `tianyi.ts` 注释 `// TODO: 设备实测校准`，不阻塞编码、上线前逐区核对。 |                        |
| G6  | **32 位值字节序**     | 文档「32 位拼接小端」= 跨两寄存器 `V = regN + regN+1*65536`（首寄存器为低字）。`ParamDef` 增 \`wordOrder:'le'                                                                                 | 'be'`，默认 `'le'\`，标注待测。 |
| G7  | **ASCII/名称寄存器**  | `A400` 段 `NAME1-16`(UTF-8)、`pwd1-8`、`imei/imsi/ccid` 走 `0x10` 多寄存器写。先按 UTF-8 定长（不足补 0）实现并标注 TODO。                                                                    |                        |
| G5  | **天一控制能力有限**     | 文档控制区仅 `A900`(系统重启)、`A901`(恢复出厂)，写 `0x0001` 触发。MOS/加热/蓝牙密码/工厂密码均为 JBD 专属，天一控制页不含。                                                                                    |                        |
| G9  | **产品名**          | `electron/main.ts` 窗口标题写死「天一BMS」；现已双协议，建议改中性「BMS 调试工具」（含 `package.json` productName、关于页）。                                                                            |                        |
| G11 | **通用寄存器读写**      | 因文档错漏多，天一控制页增「寄存器读写」调试区（读保持寄存器 X 数量 Y / 写单寄存器 X=V），便于现场核对。                                                                                                           |                        |
| G12 | **订阅隔离**         | 天一页仅在 `protocol=tianyi` 时挂载 → `useTianyi` 的 `onFrame` 订阅不会与 `useJbd` 交叉；`deviceBus` 为单实例共享同一串口。                                                                      |                        |
| G3  | **Modbus 地址已确认** | 读指令样本 `01 03 a0 00 00 2f` → 从机01/功能03/起始 `0xA000`/数量 47。故「A000」即 Modbus 保持寄存器 `0xA000`(40960)，下发 0 基准、无 40001 偏移。无歧义。                                                |                        |
| G10 | **构建/打包**        | 本地仅 `pnpm build`（vue-tsc + vite）；不本地打安装包；提交/打 tag/推送触发 CI 待最后确认。                                                                                                     |                        |

---

## 3. 总体架构（并列独立页面）

```
串口字节流
  │  electron/serial.ts —— 已协议无关，不改
  ▼
deviceBus  (原 jbd-bus.ts，协议可插拔；保留 jbdBus 别名，默认 JBD)
  ├─ 持有 activeAdapter（连接时按所选协议 setProtocol）
  ├─ feed(bytes) → activeAdapter.createParser().feed() → 广播 BusFrame
  ├─ sendAck/send → 串行队列，按 activeAdapter.matchResponse(reqKey, f.cmd) 配对应答
  ▼
activeAdapter (ProtocolAdapter)
  ├─ jbdAdapter   : 封装 jbd-protocol.ts / JbdSession（parser 把 JBD Frame→BusFrame）
  └─ tianyiAdapter: Modbus-RTU（crc16.ts + modbus-session.ts + 全量 paramTable）
        │                         │
   ┌────┴─────┐            ┌──────┴──────┐
 JBD 页面（冻结）       天一页面（新增）
 JbdPanel /             TianyiPanel /
 JbdParamConfig /       TianyiParamConfig /
 JbdControl +           TianyiControl +
 useJbd（冻结）         useTianyi（新增）
```

**不改动**：`electron/serial.ts`、`electron/preload.ts`、`electron/main.ts`、`src/env.d.ts`、`src/constants.ts`（时序常量通用）、`src/store.ts`（仅可选加 `ui.protocol` 镜像）；`src/jbd/*`（useJbd、jbd-session、jbd-protocol、jbd-params）**冻结**，仅 `useJbd` 的 `Frame` 类型 import 微调为 `BusFrame`（字段对齐，逻辑不变）。

---

## 4. 新增文件清单

### 4.1 `src/protocols/types.ts` — 统一抽象类型

```ts
export interface BusFrame {                 // 总线向订阅者广播的统一结构
  cmd: number        // JBD=命令码；Modbus=功能码(异常时 0x80|func)
  status: number     // 0=OK；JBD=原状态字节；Modbus=0 或异常码
  data: number[]     // 协议头之后、校验/CRC 之前的载荷字节
  valid: boolean
  raw: number[]
  timeout?: boolean
}
export interface FrameParser { feed(chunks:number[], emit:(f:BusFrame)=>void):void; reset():void }

export type ParamKind = 'u16'|'i16'|'u32'|'i32'|'enum'|'ascii'|'bit'
export interface ParamDef {
  reg: number; name: string; group: string
  unit?: string; kind: ParamKind
  offset?: number; resolution?: number; signed?: boolean; wordOrder?: 'le'|'be'
  min?: number; max?: number; step?: number; decimals?: number
  options?: { label:string; value:number }[]   // enum
  asciiBytes?: number                            // ascii
  bit?: number                                   // bit 开关所在位
  rw: 'r'|'w'|'rw'
}
export interface ControlItem { label:string; reg:number; value:number; confirm?:boolean }
export interface ControlSection { title:string; items: ControlItem[] }
export interface ProtocolAdapter {
  id:'jbd'|'tianyi'; label:string
  defaultConnect:{baudRate:number;dataBits:5|6|7|8;stopBits:1|1.5|2;parity:string}
  defaultSlave:number
  createParser():FrameParser
  responseKey(req:number[]):number
  matchResponse(reqKey:number, fcmd:number):boolean
  buildRead(reg:number,count:number,slave:number):number[]
  buildWriteSingle(reg:number,value:number,slave:number):number[]
  buildWriteMulti(reg:number,values:number[],slave:number):number[]
  controlSections:ControlSection[]
  describeFrame(frame:BusFrame):string
  probe(slave:number):number[]                 // 连接验证帧
}
```

### 4.2 `src/protocols/crc16.ts` — 标准 Modbus CRC16

```ts
export function crc16Modbus(buf:number[]):[number,number]{
  let crc=0xFFFF
  for(const b of buf){ crc ^= b & 0xff
    for(let i=0;i<8;i++) crc = (crc&1) ? ((crc>>1)^0xA001) : (crc>>1) }
  return [crc&0xff,(crc>>8)&0xff]   // 低字节在前
}
export function crc16ModbusValid(frame:number[]):boolean{
  const body=frame.slice(0,frame.length-2), [lo,hi]=crc16Modbus(body)
  return frame[frame.length-2]===lo && frame[frame.length-1]===hi
}
```

### 4.3 `src/protocols/modbus-session.ts` — Modbus-RTU 字节流切帧

按功能码推导长度 + CRC16 校验；未知/错 CRC 则丢弃 1 字节重新同步：

```ts
// func 0x03/0x04: 总长 = 5 + byteCount(=buf[2])
// func 0x06/0x10: 固定 8 字节
// func & 0x80 (异常): 固定 5 字节
// 满足长度后校验 CRC16；通过 → emit BusFrame{cmd:func, status:异常?errCode:0,
//        data:func 与 crc 之间的字节(含 byteCount), valid:true}
```

> 单元自测覆盖：0x03 多寄存器、0x06 单写回执、0x10 多写回执、0x83/0x84 异常、字节粘连/分片/错字节重同步。

### 4.4 `src/protocols/jbd.ts` — JBD 适配器（薄封装，供总线插拔）

- `createParser()`：内部 `new JbdSession(f => emit(convertJbdToBusFrame(f)))`，把 JBD `Frame{cmd,status,len,data,valid}` 映射为 `BusFrame{cmd:f.cmd,status:f.status,data:f.data,valid:f.valid,raw}`。
- `responseKey(req)=req[2]&0xff`；`matchResponse=(k,f)=>k===f`。
- `buildRead/buildWriteSingle/…`：委托 `jbd-protocol.ts` 现有 `buildReadParam/buildWriteParam`（语义等价）。
- `describeFrame`：迁移现有 `jbd-protocol.describeFrame` 逻辑。
- `probe(slave)=buildReadBasicInfo()`（JBD 验证帧）。
- `controlSections`：留空（JBD 控制由冻结的 `JbdControl.vue` 负责，不经适配器）。

### 4.5 `src/protocols/tianyi.ts` — 天一适配器（核心新增）

- `createParser()`：返回 `new ModbusSession(emit)`。
- `responseKey(req)=req[1]&0xff`；`matchResponse=(k,f)=> f===k || f===(0x80|k)`。
- `buildRead(reg,count,slave)=[slave,0x03, reg>>8,reg&0xff, count>>8,count&0xff, ...crc16]`；`buildWriteSingle=[slave,0x06,…]`；`buildWriteMulti=[slave,0x10, startHi,startLo, qtyHi,qtyLo, byteCount, …values, …crc]`。
- `paramTable`：**全量录入 A0–AA（除 OTA）**，按文档分区建 `group`：电池信息/单体电压/单体温度/用户信息/配置/保护/校准/休眠/复位控制/时间戳。每条带 `offset/resolution/signed/wordOrder/rw/min/max/options/bit`，已知错漏处 `// TODO: 设备实测校准`。
- `controlSections`：`[{title:'复位/控制', items:[{label:'系统重启',reg:0xA900,value:0x0001,confirm:true},{label:'恢复出厂',reg:0xA901,value:0x0001,confirm:true}]}]`。
- `describeFrame`：Modbus 帧中文说明（读 A000 电池信息 / 写 A500 配置 / 系统重启 …）。
- `probe(slave)=buildRead(0xA000,1,slave)`。
- `parseTelemetry`：把 A000 块（data 中为 `[byteCount, reg0Hi,reg0Lo,…]`）映射为天一自有 `TianyiTelemetry`：`{ totalVoltage, current, soc, soh, cycleCount, cellCount, tempCount, protect1, protect2, alarm1, alarm2, status1, status2, fet:{charge,discharge}, balanceLow, balanceHigh, … }`（字段语义按文档，缺省 0/undefined）。单体电压(A100)、温度(A300) 由轮询另取，写入同结构。

### 4.6 `src/protocols/active.ts` — 激活协议状态（可持久化）

```ts
import { reactive } from 'vue'
import { jbdAdapter } from './jbd'; import { tianyiAdapter } from './tianyi'
export const adapters = { jbd:jbdAdapter, tianyi:tianyiAdapter }
export const devState = reactive({
  protocolId: (localStorage.getItem('vg_protocol')==='tianyi'?'tianyi':'jbd') as 'jbd'|'tianyi',
  slave: Number(localStorage.getItem('vg_slave_addr')||'1'),
})
export function activeAdapter(){ return adapters[devState.protocolId] }
export function setProtocol(id:'jbd'|'tianyi'){ devState.protocolId=id; localStorage.setItem('vg_protocol',id) }
```

### 4.7 `src/protocols/bus.ts` — 协议可插拔总线（由 jbd-bus.ts 演化）

- 移除 `frame[2]` 硬编码匹配；持有 `activeAdapter()`；`feed(bytes)→activeAdapter().createParser().feed(bytes,emit)`。
- `sendAck(frame)`：`reqKey=activeAdapter().responseKey(frame)`；`pump` 中 `if(!activeAdapter().matchResponse(reqKey, f.cmd)) return`。
- 保留 `send/onceResponse/onFrame/setSender/setConnected/clear`、串行队列、QUEUE_CAP、FRAME_TIMEOUT_MS 行为不变。
- 导出 `deviceBus`；**同时 `export const jbdBus = deviceBus` 别名**，使 `useJbd` 等旧 import 零改动。

### 4.8 `src/tianyi/useTianyi.ts` — 天一状态层（新增单例）

- `telemetry = ref<TianyiTelemetry|null>`；`cellVoltages`、`temperatures`、`paramResult`、`ackHistory`、`inFactory`(天一无)、`autoPollProxy`。
- `handleFrame(f:BusFrame)`：`if(!f.valid)` 报错；`if(f.status!==0)` 报错（异常码映射中文）；按 A000/A100/A300 等解析填 `telemetry`/`cellVoltages`/`temperatures`。
- 轮询：`startPoll` 按 round-robin 发 `A000(信息)/A100(cellCount)/A300(tempCount)` 等块（每块一个轮询 tick，bus 串行化自然满足 ≥500ms；3s 无响应判通讯故障）。
- `readParam/writeParam`：经 `deviceBus.sendAck(activeAdapter().buildRead/buildWriteSingle)`。
- `onMounted` 订阅 `deviceBus.onFrame(handleFrame)`，`onUnmounted` 取消（保证 G12 隔离）。
- 导出 `useTianyi()`。

### 4.9 `src/components/TianyiPanel.vue` — 天一监测页（新增，独立）

- 布局参考 `JbdPanel.vue`：左列电池概览(总压/电流/SOC/循环/均衡/保护告警 chips) + 设备信息 + 保护事件；右列单体电压栅格 + 温度。
- 数据绑定 `useTianyi().telemetry`（`TianyiTelemetry` 自有形状，不复用 `BasicInfo`）。
- 自动轮询开关 + 读取全部（复用 `autoPollProxy` 模式）。

### 4.10 `src/components/TianyiParamConfig.vue` — 天一配置页（新增，数据驱动）

- 完全由 `tianyiAdapter.paramTable` 驱动（按 `group` 分组渲染，左右两列 + 搜索/折叠）。
- 字段类型：u16/i16/u32/i32（min/max/step/单位，raw↔display 用 `offset/resolution/wordOrder`）；enum（下拉 options）；ascii（文本，UTF-8 编码下发）；bit（开关，同 `reg` 位共用一份位图，类似 JBD bitmap 机制）。
- 读取经 `deviceBus.sendAck(tianyiAdapter.buildRead)`；批量读按连续段合并（沿用 JBD 的 chunk 思路，改为 Modbus 0x03 多寄存器）。
- 导入/导出 JSON：`{type:'tianyi-param-config', version, params:[{reg,label,unit,value,raw}]}`。

### 4.11 `src/components/TianyiControl.vue` — 天一控制页（新增）

- 由 `tianyiAdapter.controlSections` 渲染：系统重启 / 恢复出厂（带确认弹窗）。
- **通用寄存器读写调试区（G11）**：读保持寄存器 X 数量 Y、写单寄存器 X=V，经 `deviceBus.sendAck(buildRead/buildWriteSingle)` 并显示原始/换算值，便于现场核对文档错漏。

### 4.12 `src/components/SerialPanel.vue` — 连接页增加协议选择

- 新增「协议」下拉（嘉百达 JBD / 天一 TIANYI，默认 JBD）；选天一时显示「从机地址」输入（1–255，默认 1，写入 `devState.slave`）。
- `emit` 的 `SerialConnectConfig` 扩展 `{ protocol:devState.protocolId, slave:devState.slave }`；连接时 `setProtocol(protocol)`。

---

## 5. 需修改的文件（摘要）

| 文件                                                                  | 改动                                                                                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/jbd/jbd-bus.ts`                                                | 重构成 `src/protocols/bus.ts`（协议可插拔，见 4.7）；保留 `jbdBus` 别名 + JBD 默认。                                                                                         |
| `src/jbd/useJbd.ts`                                                 | **冻结**，仅 `import type { Frame }` → `import type { BusFrame }`（字段对齐，逻辑不变）。                                                                                |
| `src/jbd/jbd-session.ts` `jbd-protocol.ts` `jbd-params.ts`          | **完全冻结，不改**。                                                                                                                                             |
| `src/components/JbdPanel.vue` `JbdParamConfig.vue` `JbdControl.vue` | **完全冻结，不改**。                                                                                                                                             |
| `src/App.vue`                                                       | 协议切换渲染 JBD 三页 vs 天一三页；连接时 `deviceBus.setProtocol(activeAdapter())`；验证帧用 `activeAdapter().probe(slave)`；`describeFrame` 改调适配器；自动连接配置带 `protocol`/`slave`。 |
| `src/components/SerialPanel.vue`                                    | 协议下拉 + 从机地址（见 4.12）。                                                                                                                                     |
| `src/store.ts`                                                      | 可选：加 `ui.protocol` 镜像（状态栏显示当前协议）。                                                                                                                        |
| `electron/*` `src/env.d.ts` `src/constants.ts`                      | **不改**。                                                                                                                                                  |
| `docs/protocol-extensibility-design.md`                             | 落地后回填实际接口（可选）。                                                                                                                                           |

---

## 6. 天一适配器关键协议细节（实现须对齐）

- **CRC**：标准 Modbus CRC16（poly 0x8005 / init 0xFFFF / 低字节在前），见 4.2。
- **地址**：A000–A9FF ⇒ Modbus 保持寄存器 `0xA000`–`0xA9FF`；下发 0 基准。
- **功能码**：0x03 读保持 / 0x04 读输入 / 0x06 写单寄存器 / 0x10 写多寄存器；异常 = `0x80|func`，`status`=异常码（01 非法功能 / 02 非法地址 / 03 非法数据 / 06 忙）。
- **字节序**：U16 大端；32 位小端（首寄存器=低字）。
- **换算**：`display = (raw − offset) × resolution`（每寄存器独立）。
- **轮询**：Tianyi 各块 ≥500ms 间隔、单条在途（bus 串行队列已保证）、3s 无响应报通讯故障。
- **文档错漏**：`ec_hw` 错位 / `T_D_KWH` 命名 / `A709` 空白 —— 全部 `// TODO: 设备实测校准`，不阻塞编码。

---

## 7. 建议实施阶段（每阶段 `pnpm build` 校验，JBD 全程作回归基线）

1. **地基**：`types.ts` / `crc16.ts` / `modbus-session.ts` / `active.ts` + 改造 `bus.ts`（先让 JBD 仍跑通：接 `jbd.ts` 适配器 + `jbdBus` 别名）。
2. **天一适配器**：`tianyi.ts`（paramTable + parseTelemetry + build* + controlSections + describeFrame），自测切帧/CRC。
3. **连接页 + App**：`SerialPanel` 协议下拉+从机地址；App 协议切换 + 验证帧 + 自动连接配置 + describeFrame 切换。
4. **天一状态层**：`useTianyi.ts` + round-robin 轮询。
5. **天一监测页**：`TianyiPanel.vue`。
6. **天一配置页**：`TianyiParamConfig.vue`。
7. **天一控制页**：`TianyiControl.vue` + 通用寄存器读写（G11）。
8. **打磨**：产品名/标题(G9)、导入导出协议标识、文档错漏 TODO 核对清单、最终 `pnpm build`。

---

## 8. 风险与验证

- **主风险 1（文档错漏 G4/G6/G7）**：offset/resolution/字节序可能不准 → 全部 TODO 标注，上线前接真实设备逐区核对；建议先拿一台天一设备跑通 A000/A100/A300 遥测 + 一个可读可写参数。
- **主风险 2（Modbus 切帧）**：无帧头帧尾，纯靠功能码长度 + CRC 重同步 → `modbus-session.ts` 必须正确处理粘连/分片/错字节，单测覆盖 0x03/0x06/0x10/异常 四种。
- **回归保障**：JBD 三页与 `src/jbd/*` 完全冻结，阶段 1–3 全程保持可用作为基线；每阶段 `pnpm build` 必须通过。
- **不本地打安装包**（既定规则）；提交/打 tag/推送触发 CI 待最后确认。
