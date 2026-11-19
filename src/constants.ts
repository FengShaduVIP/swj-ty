// 全局时序与容量常量（集中管理，避免散落各文件的魔法数字）
// 注意：Electron 主进程（electron/*）下的自动连接轮询/验证超时等保持各自局部常量，
// 因其运行于独立 bundle，避免与主进程别名解析耦合。

/** 单帧请求-响应超时（ACK / 解析等待），单位 ms */
export const FRAME_TIMEOUT_MS = 1500

/** 实时监测自动轮询间隔，单位 ms（0x03+0x04 两帧 ≈ 90B/s，9600 波特率下约 10% 总线占用） */
export const POLL_INTERVAL_MS = 1000

/** 保护状态查询间隔，单位 ms */
export const PROT_QUERY_INTERVAL_MS = 5000

/** 通信日志最大保留条数 */
export const LOG_MAX_LINES = 500
