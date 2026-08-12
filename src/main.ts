import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import './design-tokens.css'
import './element-theme.css'
import './style.css'

const app = createApp(App)
app.use(ElementPlus)
app.mount('#app')
