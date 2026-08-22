/**
 * 本地配置模板管理（localStorage 持久化）——从 JbdParamConfig.vue 拆出。
 * 模板与导出文件同构：{ type, version, params: [...] }。
 * 对「当前配置怎么导出」「导入数据怎么应用」以依赖注入方式解耦。
 */
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fmtDateTime } from '@/utils/time'

export interface ConfigTemplate {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  data: any  // 与导出文件同构：{ type, version, params: [...] }
}

const TEMPLATE_KEY = 'jbd-param-templates'

export function useParamTemplates(deps: {
  /** 构建与导出文件同构的当前配置快照 */
  buildExportData: () => { params: unknown[] }
  /** 应用导入数据到表单（与文件导入同源逻辑） */
  applyImport: (data: any) => void
  /** 处理上传文件（模板弹窗内「从文件导入」复用） */
  onFileChange: (uploadFile: any) => void
}) {
  const templateDialogVisible = ref(false)
  const templates = ref<ConfigTemplate[]>([])

  function loadTemplates() {
    try {
      const raw = localStorage.getItem(TEMPLATE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      templates.value = Array.isArray(parsed) ? parsed : []
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

  function openTemplateDialog() {
    loadTemplates()
    templateDialogVisible.value = true
  }

  /** 从模板列表中选择一个模板直接导入 */
  function importFromTemplate(t: ConfigTemplate) {
    templateDialogVisible.value = false
    deps.applyImport(t.data)
  }

  /** 模板对话框内的「从文件导入」：关闭对话框后走原文件解析流程 */
  function onFileChangeFromDialog(uploadFile: any) {
    templateDialogVisible.value = false
    deps.onFileChange(uploadFile)
  }

  /** 当前配置保存为本地模板 */
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

  /** 模板更新时间展示（YYYY-MM-DD HH:mm） */
  const formatTemplateDate = (ts: number) => fmtDateTime(ts, false)

  return {
    templates, templateDialogVisible,
    loadTemplates, openTemplateDialog, importFromTemplate, onFileChangeFromDialog,
    saveAsTemplate, renameTemplate, deleteTemplate, formatTemplateDate,
  }
}
