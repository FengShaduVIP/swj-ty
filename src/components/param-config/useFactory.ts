/** 工厂模式进入/退出（0xFA）：sendAck 配对应答 + FACTORY_RETRY 次重试 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { jbdBus } from '@/jbd/jbd-bus'
import { buildEnterFactory, buildExitFactory } from '@/jbd/jbd-protocol'
import type { Frame } from '@/jbd/jbd-protocol'

// 进入/退出改用 sendAck（请求-应答配对）：sendAck 的超时计时从帧真正出队上线那一刻起算
// （见 jbd-bus.ts pump），而非旧「send + onceResponse」在调用瞬间就启动 1500ms 预算。
// 旧写法下若实时轮询帧恰在途（共享总线单帧在途锁 busy=true），进入工厂的帧需在队列里等轮询
// 完成才上线，排队+往返一旦 > 1500ms 即超时 → 首次点击下发失败（设备实则已进入工厂态）。
// 叠加至多 FACTORY_RETRY 次重试，彻底消除该竞态导致的偶发首次失败（影响所有 0xFA 工厂模式写入）。
const FACTORY_RETRY = 2

export function useFactory() {
  const autoFactory = ref(true)
  const inFactory = ref(false)

  async function enterFactory(): Promise<boolean> {
    let last: Frame | null = null
    for (let i = 0; i <= FACTORY_RETRY; i++) {
      last = await jbdBus.sendAck(buildEnterFactory())
      if (!last.timeout && last.status === 0x00) {
        inFactory.value = true
        return true
      }
    }
    ElMessage.error('进入工厂模式失败: ' + (last?.timeout ? '超时' : `0x${(last?.status ?? 0).toString(16)}`))
    return false
  }

  async function exitFactory(): Promise<boolean> {
    let last: Frame | null = null
    for (let i = 0; i <= FACTORY_RETRY; i++) {
      last = await jbdBus.sendAck(buildExitFactory())
      if (!last.timeout && last.status === 0x00) {
        inFactory.value = false
        return true
      }
    }
    ElMessage.error('退出工厂模式失败: ' + (last?.timeout ? '超时' : `0x${(last?.status ?? 0).toString(16)}`))
    return false
  }

  return { autoFactory, inFactory, enterFactory, exitFactory }
}
