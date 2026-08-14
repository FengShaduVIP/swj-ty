# 多通讯协议可扩展设计（设计文档 + 文件级方案）

> 状态：设计阶段（尚未实现）。本文定义「天一 BMS 上位机」接入第二种及以上通讯协议时，
> 如何在不改视图代码的前提下，让参数配置页、实时监测页、下发/解析指令随协议切换而变化。
> 当前实现仅 JBD 一种协议，相关逻辑散落在 `jbd-protocol.ts` / `jbd-params.ts` / `jbd-session.ts` /
> `useJbd.ts` / `JbdParamConfig.vue` / `JbdPanel.vue`。

---

## 1. 目标与非目标

**目标**
- 新增协议 = 增加一个「适配器文件」+ 注册一行，视图层零改动或极小改动。
- 参数配置页的参数（寄存器映射、单位、选项、分组）由协议驱动，而非硬编码。
- 下发帧构造、应答解析、帧切分、校验算法均随协议替换。
- 用户在「设备连接 / 设置」里选择协议，选择持久化。

**非目标（本期不做）**
- 同一时刻多协议并发。
- 协议热插拔运行时动态加载（仍走编译期注册）。
- 自动探测协议（需用户显式选择）。

---

## 2. 目标架构

```
┌──────────── 视图层（尽量保持通用） ────────────┐
│  SerialPanel    JbdPanel(监测)   JbdControl    JbdParamConfig   │
│      │              │                │              │          │
│      └─────── 仅依赖「激活协议」提供的统一接口 ─────┘          │
└────────────────────────┬───────────────────────────────────────┘
                         │ 读取 activeProtocol()
┌────────────────────────▼───────────────────────────────────────┐
│  ProtocolRegistry（Map<id, ProtocolAdapter>）                   │
│    ├─ jbd            (现有 JBD 逻辑封装为首个 adapter)          │
│    └─ modbus-rtu     (未来示例：Modbus-RTU BMS)                 │
└────────────────────────┬───────────────────────────────────────┘
                         │ 每个 adapter 自带
        ┌────────────────┼─────────────────────────┐
        ▼                ▼                         ▼
  帧层(切帧/校验/   参数表(ParamDef[])      遥测归一(DeviceTelemetry)
  构造/解析)         + 分组(GroupDef)        mapTelemetry(frames)
```

传输层（`serial.ts` / `jbd-bus.ts` / `DataLog.vue` / 设计令牌）**保持不变**——
它们是协议无关的字节管道与 UI 体系。

---

## 3. 核心接口契约（src/protocols/types.ts）

```ts
// 帧方向
export type FrameDir = 'read' | 'write'

// 下发请求（视图/组合式只描述"要做什么"，不直接拼字节）
export interface DownlinkRequest {
  cmd: number
  payload?: number[]      // 协议自定义负载字节
  reg?: number            // 参数读写的寄存器/地址
  count?: number
}

// 上行帧（已切帧、已剥离校验）
export interface UplinkFrame {
  cmd: number
  status: number
  data: number[]
  raw: number[]
}

// 帧解析器（不同协议差异最大：长度字段 vs CRC 定界）
export interface FrameParser {
  feed(bytes: number[]): UplinkFrame[]   // 喂入原始字节，吐出 0..N 个完整帧
  reset(): void
}

// 参数定义（驱动参数配置页；保留现有 FieldDef 的丰富语义）
export interface ParamDef {
  key: string
  label: string
  index: number             // 协议寄存器/地址
  group: string             // 分组标题（驱动配置页布局）
  unit?: string
  decimals?: number
  step?: number
  min?: number
  max?: number
  rw?: 'r' | 'w' | 'rw'
  options?: { label: string; value: number }[]
  bitIndex?: number         // 位开关支持
  bit?: number
  scale?: number
  kind?: string
  note?: string
  needPassword?: boolean
}

// 归一化遥测（监测页只认这个模型，不认协议细节）
export interface DeviceTelemetry {
  voltage?: number
  current?: number
  soc?: number
  temperature?: number[]
  cells?: number[]
  // ...按需扩展
}

// 协议适配器（一个协议 = 一个实现）
export interface ProtocolAdapter {
  id: string
  name: string
  defaultConn?: Partial<SerialConnectConfig>
  createParser(): FrameParser
  calcChecksum(body: number[]): [number, number]
  buildFrame(req: DownlinkRequest): number[]
  paramTable: ParamDef[]
  mapTelemetry(frames: Map<number, UplinkFrame>): DeviceTelemetry
}
```

---

## 4. 注册表与激活态（src/protocols/registry.ts + index.ts）

```ts
// registry.ts
const registry = new Map<string, ProtocolAdapter>()
export function registerProtocol(a: ProtocolAdapter) { registry.set(a.id, a) }
export function getProtocol(id: string) { return registry.get(id) }
export function listProtocols() { return [...registry.values()] }

// index.ts
import { ref } from 'vue'
import { jbdAdapter } from './jbd'
// import { modbusRtuAdapter } from './modbus-rtu'   // 未来
registerProtocol(jbdAdapter)
// registerProtocol(modbusRtuAdapter)

export const activeProtocolId = ref(localStorage.getItem('vg_protocol') || 'jbd')
export function activeProtocol(): ProtocolAdapter {
  return getProtocol(activeProtocolId.value) ?? jbdAdapter
}
export function setProtocol(id: string) {
  activeProtocolId.value = id
  localStorage.setItem('vg_protocol', id)
}
```

---

## 5. 现有 JBD 如何迁入首个适配器（src/protocols/jbd.ts）

**策略：最小风险，不改行为。** 不重写现有逻辑，而是把 `jbd-protocol.ts` /
`jbd-params.ts` / `jbd-session.ts` 通过 `jbd.ts` 适配成 `ProtocolAdapter`：

- `createParser()` → 返回包装 `JbdSession` 的对象（feed 调 `session.feed`）。
- `calcChecksum()` → 转发现有 `calcChecksum`。
- `buildFrame({cmd, reg, count, payload})` → 映射到 `buildRead` / `buildWrite` /
  `buildReadParam` / `buildWriteParam` / 控制类指令。
- `paramTable` → 由现有 `GROUP_DEFS` + `PARAM_TABLE` 展平为 `ParamDef[]`（保留
  `bitIndex`/`options`/`scale` 等字段）。
- `mapTelemetry()` → 调用现有 `parseBasicInfo` / `parseCellVoltages` 等，填充
  `DeviceTelemetry`。

> 现有 `jbd-*.ts` 文件可保留并 re-export，或整体迁入 `protocols/jbd.ts`。
> 建议先保留原文件、仅在 `jbd.ts` 内组合，降低回归风险；后续再择机合并。

---

## 6. 视图层需要的最小改动

| 文件 | 改造点 |
|---|---|
| `useJbd.ts`（建议改名 `useDevice.ts`） | 所有 `build* / parse*` / 参数读写改为调用 `activeProtocol()` 的成员；轮询逻辑不变 |
| `JbdParamConfig.vue` | `GROUP_DEFS`/`PARAM_TABLE` 硬编码 → `activeProtocol().paramTable`；分组由 `param.group` 聚合；读写走 `adapter.buildFrame` |
| `JbdPanel.vue` | 监测读数来源由直接 `parseBasicInfo` → `activeProtocol().mapTelemetry(...)` 填充归一模型 |
| `JbdControl.vue` | MOS/控制/密码等指令改为 `adapter.buildFrame` 构造；若某协议无对应指令则按 `adapter` 能力显隐 |
| `SerialPanel.vue` / 设置 | 增加「协议」下拉（来自 `listProtocols()`），选择写 `setProtocol()` |
| `App.vue` | 将 `activeProtocol()` 透传给视图；导航结构不变 |

> 关键收益：新增协议时，**以上 6 处无需再改**，只新增一个 adapter 文件 + 一行注册。

---

## 7. 如何新增第二种协议（以 Modbus-RTU BMS 为例）

1. 新建 `src/protocols/modbus-rtu.ts`，导出 `modbusRtuAdapter: ProtocolAdapter`。
2. 实现 `createParser()`：按 `地址+功能码+长度` + **CRC16** 切帧（与 JBD 长度字段+自定义和校验不同）。
3. 实现 `calcChecksum` 为 **CRC16**（注意与 JBD 自定义和区分）。
4. 实现 `buildFrame`：保持寄存器读 `0x03` / 写 `0x10` 的 PDU 构造。
5. 定义该设备的 `paramTable`（寄存器映射、单位、选项、分组）。
6. 实现 `mapTelemetry` 把该设备的保持寄存器映射到 `DeviceTelemetry`。
7. 在 `index.ts` `registerProtocol(modbusRtuAdapter)`。
8. 在连接/设置 UI 加入协议选择。

> 全程**零视图改动**。

---

## 8. 风险与开放决策

- **遥测模型漂移**：若新协议暴露 `JbdPanel` 当前不渲染的数据，需扩展 `DeviceTelemetry`
  并在 `JbdPanel` 增加展示位（或允许协议提供自定义监测组件——更灵活但工作量更大）。
  建议：先以「归一模型 + 扩展字段」为主，特殊协议再走自定义组件。
- **参数语义差异**：位打包开关、查表选项、独立配置项（如检流电阻）等需用 `ParamDef`
  的 `bitIndex/bit/options/needPassword` 等字段表达，保持现有丰富度。
- **解析器差异**：`FrameParser` 抽象必须同时覆盖「长度字段型（JBD）」与
  「CRC 定界型（Modbus-RTU）」。两种实现都提供。
- **校验算法**：不同协议校验不同，必须放在 adapter 内，禁止在 `jbd-bus` 等通用层写死。
- **默认连接参数**：不同协议常用波特率/校验不同，由 `adapter.defaultConn` 提供默认值。

---

## 9. 文件级改造清单（实施时参考）

**新增**
- `src/protocols/types.ts` — 上述接口
- `src/protocols/registry.ts` — 注册表
- `src/protocols/index.ts` — 激活态 + 注册 JBD
- `src/protocols/jbd.ts` — JBD 适配器（封装现有逻辑）
- `src/protocols/modbus-rtu.ts` — 未来参考实现（模板）

**重构**
- `useJbd.ts` → 参数化 `activeProtocol()`（建议保留 `useJbd` 导出名，内部切换）
- `JbdParamConfig.vue` — 数据源改为 `activeProtocol().paramTable`
- `JbdPanel.vue` — 遥测源改为 `activeProtocol().mapTelemetry`
- `JbdControl.vue` — 指令构造改为 `adapter.buildFrame`
- `SerialPanel.vue` / `App.vue` / 设置 — 协议选择器

**不变**
- `jbd-bus.ts`（通用帧总线）、`serial.ts` / `main.ts` / `preload.ts`（传输）、
  `DataLog.vue`、`design-tokens.css` / `element-theme.css`。

---

## 10. 工作量估算

- 抽象层脚手架（types/registry/index/jbd 适配器封装）：约 1 天
- `useJbd` + 参数配置页 + 监测页协议化重构：约 1–2 天
- 参考实现第二种协议（如 Modbus-RTU）：约 0.5–1 天

> 全部完成后，后续每接入一种新协议 ≈ 0.5–1 天（仅写 adapter，无视图改动）。
