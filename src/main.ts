import { createApp } from 'vue'
import ElementPlus from 'element-plus'
// 全局中文语言包：el-date-picker 等组件的弹窗以中文呈现（英文 locale 会显示月份英文缩写）
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import './design-tokens.css'
import './element-theme.css'
import './style.css'

const app = createApp(App)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
