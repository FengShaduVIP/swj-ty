import { createApp } from 'vue'
// ElMessage / ElMessageBox 是 JS 直调 API，不经过模板，按需解析器覆盖不到，
// 样式需手动引入（组件本体已由各使用处直接 import）
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
// 暗色主题变量（保持原有全量引入时代的暗色表现）
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import FloatWindow from './components/FloatWindow.vue'
import NotifyToast from './components/NotifyToast.vue'
import './design-tokens.css'
import './element-theme.css'
import './style.css'

// 同一 bundle 三种形态：主进程以 hash 区分——
//   #float  置顶浮窗（FloatWindow）
//   #notify 屏幕级通知窗（NotifyToast，透明置顶右上角）
//   其余    完整应用（App）
const hash = window.location.hash
const isFloat = hash.includes('float')
const isNotify = !isFloat && hash.includes('notify')
const app = createApp(isFloat ? FloatWindow : isNotify ? NotifyToast : App)
app.mount('#app')
