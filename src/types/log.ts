/** 通信日志条目（App / SerialPanel / DataLog 共用） */
export interface LogEntry {
  time: string
  type: 'send' | 'recv' | 'error' | 'info'
  content: string
}
