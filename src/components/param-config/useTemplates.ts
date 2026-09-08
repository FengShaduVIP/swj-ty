/** 本地配置模板（localStorage）：增删改查 + 从模板/文件导入 */
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ConfigTemplate } from './types'

const TEMPLATE_KEY = 'jbd-param-templates'

export function useTemplates(deps: {
  /** 当前页面配置 → 导出同构数据（存为模板用） */
  buildExportData: () => { params: unknown[] }
  /** 将模板数据应用到页面（导入） */
  applyImport: (data: any) => void
  /** 模板对话框内「从文件导入」复用主页面的文件解析流程 */
  onFileChange: (uploadFile: any) => void
  /** 导入来源名称展示（主页提示当前导入的是哪个模板） */
  setImportedSourceName: (name: string) => void
}) {
  const templateDialogVisible = ref(false)
  const templates = ref<ConfigTemplate[]>([])

  function loadTemplates() {
    try {
      const raw = localStorage.getItem(TEMPLATE_KEY)
      templates.value = raw ? JSON.parse(raw) : []
      if (!Array.isArray(templates.value)) templates.value = []
    } catch {
      templates.value = []
    }
  }
  function persistTemplates() {
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates.value)) } catch { /* 忽略写入失败 */ }
  }
  function genId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }
  function formatDate(ts: number): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  function openTemplateDialog() {
    loadTemplates()
    templateDialogVisible.value = true
  }

  // 从模板列表中选择一个模板直接导入
  function importFromTemplate(t: ConfigTemplate) {
    templateDialogVisible.value = false
    deps.setImportedSourceName('模板：' + t.name)
    deps.applyImport(t.data)
  }

  // 模板对话框内的「从文件导入」：关闭对话框后用原流程解析
  function onFileChangeFromDialog(uploadFile: any) {
    templateDialogVisible.value = false
    deps.onFileChange(uploadFile)
  }

  // 当前配置保存为本地模板
  async function saveAsTemplate() {
    const data = deps.buildExportData()
    if (!data.params.length) { ElMessage.warning('当前没有可保存的参数（请先读取或填写）'); return }
    try {
      const { value } = await ElMessageBox.prompt('请输入模板名称', '保存为模板', {
        inputValue: `模板 ${templates.value.length + 1}`,
        confirmButtonText: '保存',
        cancelButtonText: '取消',
      })
      const name = (value || '').trim() || `模板 ${templates.value.length + 1}`
      const now = Date.now()
      templates.value.push({ id: genId(), name, createdAt: now, updatedAt: now, data })
      persistTemplates()
      ElMessage.success(`已保存模板「${name}」`)
    } catch { /* 用户取消 */ }
  }

  async function renameTemplate(t: ConfigTemplate) {
    try {
      const { value } = await ElMessageBox.prompt('修改模板名称', '重命名模板', {
        inputValue: t.name,
        confirmButtonText: '确定',
        cancelButtonText: '取消',
      })
      const name = (value || '').trim()
      if (!name) return
      t.name = name
      t.updatedAt = Date.now()
      persistTemplates()
    } catch { /* 用户取消 */ }
  }

  async function deleteTemplate(t: ConfigTemplate) {
    try {
      await ElMessageBox.confirm(`确定删除模板「${t.name}」吗？此操作不可恢复。`, '删除模板', { type: 'warning' })
      templates.value = templates.value.filter((x) => x.id !== t.id)
      persistTemplates()
    } catch { /* 用户取消 */ }
  }

  return {
    templates,
    templateDialogVisible,
    openTemplateDialog,
    importFromTemplate,
    onFileChangeFromDialog,
    saveAsTemplate,
    renameTemplate,
    deleteTemplate,
    formatDate,
  }
}
