# -*- coding: utf-8 -*-
"""生成《天一BMS 锂电池 PACK 上位机监控软件 操作说明书》PDF。
基于 serial-modbus-tool 实际界面（单协议 JBD / 嘉佰达）编写。
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, ListFlowable, ListItem, Image,
)
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

# ---- 中文 CJK 字体（无需外部字体文件）----
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
FONT = 'STSong-Light'

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   '天一BMS操作说明书_v2.2.0.pdf')

# ---- 样式 ----
styles = getSampleStyleSheet()
def S(name, **kw):
    base = kw.pop('parent', styles['Normal'])
    return ParagraphStyle(name, parent=base, fontName=FONT, **kw)

styleTitle = S('t', fontSize=22, leading=28, alignment=TA_CENTER,
               textColor=colors.HexColor('#0A2E5C'), spaceAfter=6)
styleSub = S('s', fontSize=12, leading=16, alignment=TA_CENTER,
             textColor=colors.HexColor('#1A73E8'), spaceAfter=2)
styleMeta = S('m', fontSize=9.5, leading=14, alignment=TA_CENTER,
              textColor=colors.HexColor('#555555'))
styleH1 = S('h1', fontSize=15, leading=20, spaceBefore=14, spaceAfter=6,
            textColor=colors.HexColor('#0A2E5C'))
styleH2 = S('h2', fontSize=12, leading=16, spaceBefore=9, spaceAfter=4,
            textColor=colors.HexColor('#1A73E8'))
styleBody = S('b', fontSize=10, leading=15, spaceAfter=5,
              alignment=TA_LEFT)
styleBullet = S('bl', fontSize=10, leading=14.5)
styleNote = S('n', fontSize=9, leading=13, textColor=colors.HexColor('#7a3b00'),
              backColor=colors.HexColor('#fff4e0'), borderPadding=5,
              spaceBefore=4, spaceAfter=6)
styleTblHead = S('th', fontSize=9.5, leading=12, textColor=colors.white)
styleTblCell = S('tc', fontSize=9, leading=12)

def P(t, st=styleBody): return Paragraph(t, st)
def h1(t): return Paragraph(t, styleH1)
def h2(t): return Paragraph(t, styleH2)

def shot(path, caption, max_width=475, max_height=290):
    """插入界面截图，保持宽高比，按可用宽度/高度自适应。"""
    full = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.exists(full):
        return []
    iw, ih = ImageReader(full).getSize()
    ratio = min(max_width / iw, max_height / ih, 1.0)
    w, h = iw * ratio, ih * ratio
    img = Image(full, width=w, height=h)
    img.hAlign = 'LEFT'
    return [Spacer(1, 4), img, Paragraph(f'<i>{caption}</i>', styleMeta), Spacer(1, 6)]

def table(data, col_widths, header=True):
    tbl = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    ts = [
        ('FONTNAME', (0, 0), (-1, -1), FONT),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#bbbbbb')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f6fb')]),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]
    if header:
        ts += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0A2E5C')),
               ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
               ('FONTNAME', (0, 0), (-1, 0), FONT)]
    tbl.setStyle(TableStyle(ts))
    return tbl

story = []

# ===================== 封面 =====================
story.append(Spacer(1, 40))
story.append(P('天一BMS 锂电池 PACK 上位机监控软件', styleTitle))
story.append(P('操 作 说 明 书', styleTitle))
story.append(Spacer(1, 10))
story.append(P('（嘉佰达 JBD 协议版 · v2.2.0）', styleSub))
story.append(Spacer(1, 26))
story.append(HRFlowable(width='60%', thickness=1, color=colors.HexColor('#1A73E8')))
story.append(Spacer(1, 16))
story.append(P('产品名称：天一BMS · 天一锂能新能源', styleMeta))
story.append(P('软件版本：v2.2.0', styleMeta))
story.append(P('适用对象：产线调试、售后维护、研发验证人员', styleMeta))
story.append(P('文档日期：2026-08-20', styleMeta))
story.append(Spacer(1, 30))
story.append(P('本说明书依据软件实际界面编写，所有菜单、按钮、字段名称均与程序一致。', styleMeta))
story.append(PageBreak())

# ===================== 目录概览 =====================
story.append(h1('目录'))
toc = ListFlowable([
    ListItem(P('1. 软件概述', styleBullet)),
    ListItem(P('2. 运行环境与安装', styleBullet)),
    ListItem(P('3. 界面布局总览', styleBullet)),
    ListItem(P('4. 设备连接', styleBullet)),
    ListItem(P('5. 实时监测', styleBullet)),
    ListItem(P('6. 参数配置', styleBullet)),
    ListItem(P('7. 设备控制', styleBullet)),
    ListItem(P('8. 设置与自动连接', styleBullet)),
    ListItem(P('9. 常见问题（FAQ）', styleBullet)),
    ListItem(P('10. 安全注意事项', styleBullet)),
    ListItem(P('11. 下发记录', styleBullet)),
], bulletType='1', leftIndent=16)
story.append(toc)
story.append(PageBreak())

# ===================== 1. 软件概述 =====================
story.append(h1('1. 软件概述'))
story.append(P('本软件是面向锂电池 PACK（电池包）的电脑端监控工具，通过 USB 转串口（如 CH340 / CP210x / FTDI 适配器）与 BMS 主板建立通信，实现只读监测、参数读写、设备控制等功能。'))
story.append(P('当前版本仅内置 <b>嘉佰达（JBD）协议</b>，上位机不再提供协议切换，连接后即按 JBD 协议与设备交互。'))
story.append(h2('主要功能'))
story.append(ListFlowable([
    ListItem(P('设备连接：配置串口参数并建立/断开通信链路。', styleBullet)),
    ListItem(P('实时监测：只读遥测电池总压、电流、SOC、单体电压、温度、保护/告警状态与保护事件次数。', styleBullet)),
    ListItem(P('参数配置：读写 0xFA 保护参数寄存器，支持分组读取、单参数下发、批量写入、导入/导出配置。', styleBullet)),
    ListItem(P('设备控制：MOS 开关、控制指令、参数读写、工厂/蓝牙密码、加热控制等可写操作。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(PageBreak())

# ===================== 2. 运行环境与安装 =====================
story.append(h1('2. 运行环境与安装'))
story.append(h2('运行环境'))
story.append(table([
    [P('项目', styleTblHead), P('要求', styleTblHead)],
    [P('操作系统', styleTblCell), P('Windows 7 / 10 / 11（64 位）', styleTblCell)],
    [P('硬件接口', styleTblCell), P('USB 端口 + 串口适配器（CH340 / CP210x / FTDI 等）', styleTblCell)],
    [P('驱动', styleTblCell), P('已安装对应串口芯片的 USB 转串口驱动，设备管理器中可见 COM 口', styleTblCell)],
    [P('权限', styleTblCell), P('建议以普通用户运行；部分系统需允许访问串口', styleTblCell)],
], [40*mm, 110*mm]))
story.append(h2('安装与启动'))
story.append(ListFlowable([
    ListItem(P('获取安装包/解压目录后，双击主程序（或经 GitHub Actions 发布的安装包）启动。', styleBullet)),
    ListItem(P('首次使用请先确认电脑已识别到 BMS 的串口（Windows 设备管理器 → 端口 (COM 和 LPT)）。', styleBullet)),
    ListItem(P('若串口列表为空，多半是驱动未安装或适配器未插好，请先处理硬件侧。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(PageBreak())

# ===================== 3. 界面布局总览 =====================
story.append(h1('3. 界面布局总览'))
story.append(P('软件主窗口自上而下分为三部分：'))
story.append(ListFlowable([
    ListItem(P('<b>顶部状态栏</b>：品牌标识、连接状态、关键读数（总压/电流/SOC/最高温）、快速连接、采样率、设置入口与版本号。', styleBullet)),
    ListItem(P('<b>左侧导航栏（Rail）</b>：四个功能页切换；可折叠（Ctrl+B）。', styleBullet)),
    ListItem(P('<b>工作区</b>：当前功能页内容；顶部有页面标题与功能提示。', styleBullet)),
    ListItem(P('<b>底部状态条</b>：连接状态提示、采样计数与频率、时钟与版本。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(h2('五个功能页'))
story.append(table([
    [P('序号', styleTblHead), P('页面', styleTblHead), P('说明', styleTblHead)],
    [P('1', styleTblCell), P('设备连接', styleTblCell), P('配置串口参数并建立与 BMS 的通信链路', styleTblCell)],
    [P('2', styleTblCell), P('实时监测', styleTblCell), P('只读遥测：基本信息、趋势曲线、单体电压分布与内阻', styleTblCell)],
    [P('3', styleTblCell), P('参数配置', styleTblCell), P('读写 0xFA 保护参数寄存器（支持导入/导出）', styleTblCell)],
    [P('4', styleTblCell), P('设备控制', styleTblCell), P('可写操作：MOS 控制、控制指令、参数读写、密码与加热', styleTblCell)],
    [P('5', styleTblCell), P('下发记录', styleTblCell), P('强制下发的本地历史记录（时间 / 蓝牙名称 / 具体参数），支持查询与删除', styleTblCell)],
], [16*mm, 34*mm, 100*mm]))
story.append(PageBreak())

# ===================== 4. 设备连接 =====================
story.append(h1('4. 设备连接'))
story.append(P('进入「设备连接」页，左侧为串口配置卡片，右侧为通信日志。'))
story.append(h2('连接步骤'))
story.append(ListFlowable([
    ListItem(P('在「串口号」下拉框中选择 BMS 对应的 COM 口（点击下拉可触发刷新）。', styleBullet)),
    ListItem(P('确认串口参数，默认 <b>波特率 9600 / 数据位 8 / 停止位 1 / 校验位 无</b>；如设备规格不同请修改。', styleBullet)),
    ListItem(P('点击「连接设备」；连接成功后状态变为「链路正常」，右侧出现连接参数摘要（协议固定为嘉佰达 JBD）。', styleBullet)),
    ListItem(P('需要断开时点击「断开连接」。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(P('提示：连接成功后软件会自动发送读取验证（含首帧补发重试），收到 BMS 应答即视为链路正常。', styleNote))
story.append(h2('通信日志'))
story.append(P('右侧日志区实时记录发送/接收/错误/信息四类报文（十六进制）。点击「清空」可清除当前日志。连接异常时可在此对照排查。'))
story.extend(shot('shots/01-设备连接.png', '图 4-1：设备连接页（未连接状态）'))
story.append(PageBreak())

# ===================== 5. 实时监测 =====================
story.append(h1('5. 实时监测'))
story.append(P('本页为只读遥测，默认开启「自动轮询（2s）」，无需手动刷新即可看到实时数据。'))
story.append(h2('顶部工具栏'))
story.append(ListFlowable([
    ListItem(P('<b>自动轮询 (2s)</b>：开启后每 2 秒自动拉取一次基本数据。', styleBullet)),
    ListItem(P('<b>同步保护事件</b>：勾选后随轮询同步拉取保护事件次数。', styleBullet)),
    ListItem(P('<b>读取全部</b>：手动立即拉取一遍全部数据；其第一条指令会先读取芯片类型，再读取其余参数。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(h2('左侧：电池概览 / 设备信息 / 保护事件'))
story.append(ListFlowable([
    ListItem(P('<b>电池概览</b>：SOC 电量条，以及总电压、循环次数、电流、剩余容量、负载功率、充电/放电开关状态；底部显示保护状态（系统正常 / N 条触发）与均衡状态。', styleBullet)),
    ListItem(P('<b>设备信息</b>：芯片类型、硬件版本（来自实时读取）。', styleBullet)),
    ListItem(P('<b>保护事件次数</b>：列出各项保护/告警的累计触发次数。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(P('保护事件项目包括：单体过压、单体欠压、整组过压、整组欠压、充电高温、充电低温、放电高温、放电低温、充电过流、放电过流、短路次数（共 11 项）。', styleNote))
story.append(h2('右侧：单体电压 / 温度'))
story.append(ListFlowable([
    ListItem(P('<b>单体电压</b>：以栅格展示各串电压，最高/最低串高亮，均衡中的串以绿色描边标识；并显示压差（mV）。', styleBullet)),
    ListItem(P('<b>温度</b>：MOS 温度圆环 + 各路 NTC 温度条（温度 1、温度 2……），超过阈值时颜色由正常转为警示/危险。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.extend(shot('shots/02-实时监测.png', '图 5-1：实时监测页（未连接状态）'))
story.append(PageBreak())

# ===================== 6. 参数配置 =====================
story.append(h1('6. 参数配置'))
story.append(P('本页用于读写 BMS 的 0xFA 保护参数寄存器，分为 11 个分组，支持搜索、读取、下发、导入/导出。'))
story.append(h2('顶部操作按钮'))
story.append(table([
    [P('按钮', styleTblHead), P('作用', styleTblHead)],
    [P('读取全部', styleTblCell), P('按连续寄存器批量读取所有参数（先读芯片类型，再读其余），回填到各分组。', styleTblCell)],
    [P('全部写入 (N)', styleTblCell), P('将已修改的 N 个参数下发给设备（需工厂模式，由程序自动进出厂）。', styleTblCell)],
    [P('强制下发', styleTblCell), P('忽略“是否已修改”标记，把所有当前显示值全量下发；常用于配置复位后重新写入。', styleTblCell)],
    [P('导入配置', styleTblCell), P('从文件或本地模板导入参数，预览后一键下发。', styleTblCell)],
    [P('导出配置', styleTblCell), P('将当前参数保存为配置文件，便于备份与批量复制。', styleTblCell)],
], [34*mm, 116*mm]))
story.append(h2('11 个参数分组'))
story.append(table([
    [P('分组', styleTblHead), P('主要内容', styleTblHead)],
    [P('基本设置', styleTblCell), P('蓝牙名称、芯片类型、电池SN码、电池型号、生产厂商/BMS编码信息、生产日期、额定充/放电电压电流功率', styleTblCell)],
    [P('电流设置', styleTblCell), P('充电/放电过流保护及延时/恢复延时、二级过流、短路保护、短路释放延时', styleTblCell)],
    [P('容量电压', styleTblCell), P('10%~100% 各 SOC 点电压、置满/置空电压', styleTblCell)],
    [P('温度探头配置', styleTblCell), P('温度探头 1~8 使能（位图，需「应用配置」下发）', styleTblCell)],
    [P('均衡设置', styleTblCell), P('均衡开启电压/压差、GPS 关闭电压/延时', styleTblCell)],
    [P('系统设置', styleTblCell), P('休眠时间、容量修正间隔、序列号等', styleTblCell)],
    [P('初始化设置', styleTblCell), P('初始化相关参数', styleTblCell)],
    [P('温度设置', styleTblCell), P('温度相关阈值参数', styleTblCell)],
    [P('保护参数', styleTblCell), P('保护类参数（14 项）', styleTblCell)],
    [P('功能设置', styleTblCell), P('功能位图（如均衡方式，需「应用配置」下发）', styleTblCell)],
    [P('检流电阻', styleTblCell), P('检流电阻相关参数', styleTblCell)],
], [34*mm, 116*mm]))
story.extend(shot('shots/03-参数配置.png', '图 6-1：参数配置页（未连接状态，二级过流/短路依赖芯片类型）'))
story.append(h2('单参数读取与下发'))
story.append(ListFlowable([
    ListItem(P('每个分组标题右侧有「读本组」按钮，可只读取该组参数。', styleBullet)),
    ListItem(P('每个字段右侧通常提供「读取 / 单参数下发」操作：读取回填当前值，下发将该字段值写入设备。', styleBullet)),
    ListItem(P('<b>二级过流保护 / 延时、短路保护 / 延时</b> 为下拉档位选择，其物理量取决于<b>芯片类型</b>；若显示「未知芯片，请先读取芯片类型」，请先执行「读取全部」或读取芯片类型后再设置。', styleBullet)),
    ListItem(P('分组支持「拖动排序」与左右两列布局调整，顺序会保存到本地。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(h2('导入 / 导出配置'))
story.append(ListFlowable([
    ListItem(P('<b>导入配置</b>：弹出预览，核对参数无误后点击「一键下发所有参数」批量写入目标设备，结果实时反馈。', styleBullet)),
    ListItem(P('<b>导入配置模板</b>：可选择本地已保存模板（无需重新选文件），或从文件导入；也可「存为模板」保存当前配置。', styleBullet)),
    ListItem(P('<b>导出配置</b>：将当前参数导出为文件，用于备份或跨设备复制。', styleBullet)),
    ListItem(P('部分参数下发需输入密码确认（弹窗提示）。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(PageBreak())

# ===================== 7. 设备控制 =====================
story.append(h1('7. 设备控制'))
story.append(P('本页提供各类可写操作，涉及写寄存器时程序会自动进入/退出工厂模式。'))
story.append(h2('MOS 控制'))
story.append(P('充电 MOS、放电 MOS 独立开关，并有「全部关闭 / 全部打开」快捷按钮。'))
story.append(h2('控制指令 (0x0A)'))
story.append(P('以下指令以按钮形式提供，点击即下发：'))
story.append(table([
    [P('重置容量', styleTblCell), P('清除记录', styleTblCell), P('复位MCU', styleTblCell), P('清除保护', styleTblCell)],
    [P('进入休眠', styleTblCell), P('掉电模式', styleTblCell), P('自动均衡', styleTblCell), P('储运模式', styleTblCell)],
    [P('SOC20%开关', styleTblCell), P('SOC20%强开', styleTblCell), P('强制启动', styleTblCell), P('强制加热', styleTblCell)],
], [37.5*mm]*4))
story.append(Spacer(1, 6))
story.extend(shot('shots/04-设备控制.png', '图 7-1：设备控制页（未连接状态）'))
story.append(h2('参数读写 (0xFA)'))
story.append(ListFlowable([
    ListItem(P('<b>工厂模式</b>：状态徽标显示「普通模式 / 工厂模式」；点击「进入工厂模式 / 退出工厂模式」切换（写入参数需工厂模式）。', styleBullet)),
    ListItem(P('<b>读取</b>：选择参数 + 读取数量 + 「读取」，下方显示原始值 / 数值 / ASCII。', styleBullet)),
    ListItem(P('<b>写入（需工厂模式）</b>：选择可写参数 + 数值 + 「写入」；程序自动完成 进入→写→退出 工厂模式。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(h2('密码'))
story.append(ListFlowable([
    ListItem(P('<b>工厂密码 (0x0B)</b>：可修改密码（原密码默认 0x5678），或「清除」恢复默认 0x5678。', styleBullet)),
    ListItem(P('<b>蓝牙密码</b>：支持「配对(设密码)」与「修改密码」（6 位）。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(h2('加热控制 (0xFC)'))
story.append(P('设置启动温度与停止温度，点击「启动加热 / 停止加热」。'))
story.append(h2('最近指令响应'))
story.append(P('页面底部显示最近下发的指令响应报文，便于确认操作是否成功。'))
story.append(PageBreak())

# ===================== 11. 下发记录 =====================
story.append(h1('11. 下发记录'))
story.append(P('左侧导航栏点击「下发记录」进入。本页用于查询和管理「参数配置 → 强制下发」产生的本地历史记录。'))
story.append(ListFlowable([
    ListItem(P('<b>自动记录</b>：每次点击「强制下发」并完成下发后，系统会把当前时间、蓝牙名称、本次下发的全部参数快照写入本地存储。', styleBullet)),
    ListItem(P('<b>搜索</b>：可按蓝牙名称、参数名或参数值进行关键字过滤。', styleBullet)),
    ListItem(P('<b>查看详情</b>：点击表格行前的展开箭头，可查看该条记录下发的全部参数（参数名、寄存器地址、下发值）。', styleBullet)),
    ListItem(P('<b>删除与清空</b>：支持单条删除或一键清空全部记录；删除后不可恢复。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.extend(shot('shots/05-下发记录.png', '图 11-1：下发记录页（示例数据，实际显示用户历史记录）'))
story.append(PageBreak())

# ===================== 8. 设置与自动连接 =====================
story.append(h1('8. 设置与自动连接'))
story.append(P('点击顶部状态栏的「设置（齿轮）」图标打开设置对话框。'))
story.append(h2('界面密度'))
story.append(P('可选「标准 / 紧凑」两种密度，紧凑模式缩小卡片内边距与控件高度，适配产线远距离查看。设置保存在本地。'))
story.append(h2('USB 自动连接'))
story.append(ListFlowable([
    ListItem(P('开启后，检测到匹配的 USB 串口设备（按 VID/PID 或名称关键字）时自动连接，收到 BMS 应答后自动跳转到实时监测页。', styleBullet)),
    ListItem(P('需填写：厂商ID (VID)、产品ID (PID)、名称关键字（可选）、波特率、数据位、停止位、校验位，并确保设备已安装串口驱动。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(h2('关于'))
story.append(P('设置底部显示产品名（天一BMS · 天一锂能新能源）、设计系统与软件版本号。'))
story.append(PageBreak())

# ===================== 9. 常见问题 =====================
story.append(h1('9. 常见问题（FAQ）'))
faq = [
    ('连接后一直「未收到 BMS 应答」？',
     '① 确认串口号选对且未被其他软件占用；② 确认串口参数（默认 9600/8/N/1）与设备一致；③ 确认串口适配器驱动已装、设备已上电；④ 重新插拔 USB 后点「连接设备」。'),
    ('实时监测看不到数据？',
     '请确认已成功连接；页面默认自动轮询，可点击「读取全部」手动拉取；若仍无数据，检查通信日志是否有收发报文。'),
    ('参数配置里「二级过流/短路保护」下拉是灰的？',
     '这些档位依赖芯片类型识别。请先点击「读取全部」（其首条指令会读取芯片类型），待「设备信息-芯片类型」显示具体型号后再设置。'),
    ('点击「强制下发」后下拉框变灰？',
     '早期版本存在进厂应答误清空芯片类型的缺陷，已在 v2.2.0 修复。请确保使用 v2.2.0 及以上版本。'),
    ('写入参数提示失败/超时？',
     '多数写操作需在工厂模式下进行；程序会自动进出厂。若持续超时，检查连接稳定性与设备是否忙。'),
    ('找不到串口？',
     '打开 Windows 设备管理器查看端口；若没有 COM 口，多为驱动未安装或适配器故障。'),
]
for q, a in faq:
    story.append(h2(q))
    story.append(P(a))
story.append(PageBreak())

# ===================== 10. 安全注意事项 =====================
story.append(h1('10. 安全注意事项'))
story.append(ListFlowable([
    ListItem(P('参数修改（尤其保护阈值、容量、检流电阻）直接影响电池安全，请由具备资质的人员操作，修改前务必「导出配置」备份。', styleBullet)),
    ListItem(P('写入关键参数后，建议断电重启并在「实时监测」中核对实际生效值。', styleBullet)),
    ListItem(P('「复位MCU / 掉电模式 / 强制启动」等指令会立即改变设备运行状态，请在安全环境下使用。', styleBullet)),
    ListItem(P('工厂密码、蓝牙密码请妥善保管；遗忘工厂密码可尝试「清除」恢复默认 0x5678（以设备实际支持为准）。', styleBullet)),
    ListItem(P('本软件仅供授权设备调试与维护使用。', styleBullet)),
], bulletType='bullet', leftIndent=16))
story.append(Spacer(1, 14))
story.append(HRFlowable(width='100%', thickness=0.6, color=colors.HexColor('#cccccc')))
story.append(Spacer(1, 6))
story.append(P('— 本说明书依据 v2.2.0 实际界面生成，如界面更新请以软件内实际显示为准 —', styleMeta))

# ===================== 输出 =====================
def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor('#888888'))
    canvas.drawString(18*mm, 10*mm, '天一BMS 操作说明书 v2.2.0')
    canvas.drawRightString(A4[0]-18*mm, 10*mm, '第 %d 页' % doc.page)
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=18*mm, rightMargin=18*mm,
                        topMargin=16*mm, bottomMargin=16*mm,
                        title='天一BMS 操作说明书 v2.2.0',
                        author='天一锂能新能源')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print('PDF generated:', OUT)
