import { createApp } from 'vue'
// ElMessage / ElMessageBox 是 JS 直调 API，不经过模板，按需解析器覆盖不到，
// 样式需手动引入（组件本体已由各使用处直接 import）
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
// 暗色主题变量（保持原有全量引入时代的暗色表现）
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import './design-tokens.css'
import './element-theme.css'
import './style.css'

const app = createApp(App)
app.mount('#app')
