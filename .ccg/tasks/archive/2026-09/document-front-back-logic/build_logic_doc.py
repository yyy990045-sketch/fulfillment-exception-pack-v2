from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

OUT = "/Users/xieweikai/Projects/fulfillment-exception-pack/履约异常处理台前后端逻辑说明.docx"


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_text(cell, text, bold=False, color="000000", size=9.5):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run(str(text))
    run.bold = bold
    run.font.name = "Heiti SC"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    for i, header in enumerate(headers):
        set_cell_text(table.rows[0].cells[i], header, bold=True, color="FFFFFF", size=9)
        shade(table.rows[0].cells[i], "7A1E1B")
    for r_idx, row in enumerate(rows):
        cells = table.add_row().cells
        for i, value in enumerate(row):
            set_cell_text(cells[i], value, size=8.8)
            if r_idx % 2 == 1:
                shade(cells[i], "FFF7F0")
    if widths:
        for row in table.rows:
            for i, width in enumerate(widths):
                row.cells[i].width = Inches(width)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_para(doc, text="", bold_lead=None, style=None, after=5):
    p = doc.add_paragraph(style=style)
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.18
    if bold_lead and text.startswith(bold_lead):
        r1 = p.add_run(bold_lead)
        r1.bold = True
        r1.font.name = "Heiti SC"
        r1._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
        r1.font.color.rgb = RGBColor(122, 30, 27)
        r2 = p.add_run(text[len(bold_lead):])
        r2.font.name = "Heiti SC"
        r2._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
    else:
        r = p.add_run(text)
        r.font.name = "Heiti SC"
        r._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
    return p


def add_bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.12
    r = p.add_run(text)
    r.font.name = "Heiti SC"
    r._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
    return p


def add_number(doc, text):
    p = doc.add_paragraph(style="List Number")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.12
    r = p.add_run(text)
    r.font.name = "Heiti SC"
    r._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
    return p


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    p.paragraph_format.space_before = Pt(12 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    return p


doc = Document()
section = doc.sections[0]
section.top_margin = Inches(0.65)
section.bottom_margin = Inches(0.65)
section.left_margin = Inches(0.72)
section.right_margin = Inches(0.72)

styles = doc.styles
styles["Normal"].font.name = "Heiti SC"
styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
styles["Normal"].font.size = Pt(10.5)
for name, size, color in [("Title", 22, "000000"), ("Heading 1", 15, "000000"), ("Heading 2", 12, "000000"), ("Heading 3", 10.5, "000000")]:
    styles[name].font.name = "Heiti SC"
    styles[name]._element.rPr.rFonts.set(qn("w:eastAsia"), "Heiti SC")
    styles[name].font.size = Pt(size)
    styles[name].font.color.rgb = RGBColor.from_string(color)

title = doc.add_paragraph(style="Title")
title.alignment = WD_ALIGN_PARAGRAPH.LEFT
title.paragraph_format.space_after = Pt(4)
title.add_run("履约异常处理台前后端逻辑说明").font.name = "Heiti SC"
subtitle = doc.add_paragraph()
subtitle.paragraph_format.space_after = Pt(12)
run = subtitle.add_run("供外部 AI 进行逻辑一致性和风险审查")
run.font.name = "Heiti SC"
run.font.size = Pt(11)
run.font.color.rgb = RGBColor(122, 30, 27)

add_table(doc, ["项目", "内容"], [
    ("文档目的", "把当前版本真实的前端、后端、数据和状态机逻辑完整展开，请外部 AI 检查是否存在矛盾、绕过、误导或不可上线的设计。"),
    ("项目位置", "/Users/xieweikai/Projects/fulfillment-exception-pack"),
    ("核对基准", "代码快照与测试结果截至 2026-09-07；本文件不把推测写成已实现功能。"),
    ("系统性质", "合成数据便携演示包，不是企业生产平台；不连接真实 CRM、订单库或生产数据库。"),
], widths=[1.15, 5.9])

heading(doc, "一 先看结论", 1)
add_para(doc, "这套系统的核心用途，是把一宗“报价、订单、回款、客诉不一致”的异常，按证据、冲突、行动和回执串成一条可回看的案件链。它不是自动替业务人员做最终判断，也不是直接改订单的执行系统。")
add_para(doc, "当前版本真正完成的是：本地合成材料读取、可定位证据抽取、差异检测、案件状态流转、审批前后动作控制、模拟回执、核验结案和评测。当前版本没有完成真实身份认证、真实角色权限、真实外部系统写入、真实 AI 模型推理和生产级并发存储。", bold_lead="边界：")

heading(doc, "二 系统边界和组成", 1)
add_table(doc, ["层次", "当前实现", "不应误解为"], [
    ("前端", "src/workbench/index.html，一个内嵌 CSS 和 JavaScript 的单页工作台。", "完整前端应用、登录系统或真实权限中心。"),
    ("HTTP 后端", "src/server.ts，Node HTTP Server，提供页面和 JSON API。", "网关、微服务或正式 API 管理层。"),
    ("案件运行时", "src/case/runtime.ts，负责状态转移、行动状态、审批、执行和结案。", "可直接接入生产订单的执行引擎。"),
    ("证据层", "src/evidence/extract.ts 和 src/conflict/detect.ts，读取合成 CSV/Markdown。", "通用 OCR、复杂文档解析或在线大模型检索。"),
    ("数据层", "按租户保存为一个 JSON 文件，路径由 PACK_STORE_DIR 决定。", "数据库事务、行级锁、备份和审计存储。"),
    ("评测", "src/eval/run.ts，对 30 个 FX 金标准和负向样例做确定性测试。", "客户生产准确率、节省工时或 ROI 证明。"),
], widths=[1.0, 3.2, 2.85])

heading(doc, "三 一次完整请求的总链路", 1)
add_para(doc, "下面是默认打开 FX-001 时的真实链路。它既是用户操作顺序，也是前后端调用顺序。")
add_table(doc, ["顺序", "前端动作", "后端逻辑", "数据变化"], [
    ("1", "页面加载，执行 loadList()。", "GET /api/cases。服务器返回 buildContestSet() 中的 FX 和 IT 案件摘要。", "未找到租户文件时还没有写入案件。"),
    ("2", "前端只保留 row.pack === fulfillment 的销售履约案件。", "服务器本身返回 40 条竞赛数据，前端当前显示 29 条 FX 履约案件；IT-001 至 IT-010 不在当前工作台列表。", "无状态变化。"),
    ("3", "执行 render()，并行请求当前案件、报告和能力快照。", "GET /api/cases/FX-001、GET /report、GET /capabilities/workbench。每个请求都会经过 ensure()。", "首次访问时 ensure() 会 openCase、ingest 并保存该租户的案件 JSON。"),
    ("4", "渲染“异常概览”。", "返回 CaseRecord、EvidencePack、CaseReport 和能力摘要。", "只读展示：案件状态、证据数、冲突数、缺口数、处理进度。"),
    ("5", "点“开始核对”，只切换前端 level，不重新请求案件。", "setLevel() 只切换三个 DOM 面板。", "无后端变化。"),
    ("6", "查看差异卡、查看依据和报告小结。", "证据和报告已在第 3 步取回；查看详情本身不写入后端。", "无后端变化。"),
    ("7", "进入处理阶段并点击动作按钮。", "依次 POST propose、approve、execute、close。每个接口调用运行时状态机并保存 JSON。", "CaseStatus 和 ActionStatus 逐步推进，并追加事件。"),
    ("8", "页面刷新或重新选择案件。", "重新读取租户 JSON，并重新生成报告和能力快照。", "能看到上一次保存的状态和事件。"),
], widths=[0.45, 2.1, 2.65, 1.85])

heading(doc, "四 前端逻辑", 1)
heading(doc, "4.1 页面启动和数据加载", 2)
add_para(doc, "前端没有独立构建框架，页面加载后直接执行脚本。currentId 默认是 FX-001，currentLevel 默认 overview，currentModule 默认 workbench。loadList() 先拉案件列表，再调用 render()。render() 对当前案件发起三个并行 GET 请求，全部成功后一次性重建 content-inner。")
add_para(doc, "页面切换案件时，switchCase() 会把 currentLevel 重置为 overview，把 currentModule 重置为 workbench，清空旧内容后再加载新案件。切换能力模块时，setModule() 会重新 render，因此能力模块切换会重新请求能力快照。三个层级之间切换使用 setLevel()，不会重新请求后端。", bold_lead="关键区别：")

heading(doc, "4.2 三层工作台", 2)
add_table(doc, ["层级", "显示内容", "当前入口规则"], [
    ("异常概览 overview", "一眼结论、负责人、案件状态、关系图、指标、进度条。", "默认进入；始终可回到。"),
    ("核对证据 investigate", "冲突卡、两侧材料、来源位置、查看依据、全部材料、核对小结。", "概览按钮可进入；层级按钮通常可用。"),
    ("处理与结案 resolve", "当前下一步、动作列表、处理记录。", "levelState 依据 resolveUnlocked(status) 和当前层级计算；动作按钮另由 actionGate(status, action) 控制。"),
], widths=[1.45, 3.4, 2.2])
add_para(doc, "前端把按钮 disabled 当作第一层体验保护，但这不是安全边界。真正能否推进，最终由后端 runtime 的状态转移和动作检查决定。外部 AI 应重点检查“前端显示规则”和“后端最终规则”是否完全一致。", bold_lead="重要：")

heading(doc, "4.3 前端动作规则", 2)
add_table(doc, ["按钮动作", "前端允许条件", "调用接口", "成功后的效果"], [
    ("开始拟定处理方案 propose", "new、triaged、confirmed。", "POST /api/cases/:id/propose", "后端推进到 proposed，并生成 draft actions，再立即标为 pending_approval。"),
    ("提交负责人确认 approve", "proposed。", "POST /api/cases/:id/approve", "后端推进到 approved，把 draft 或 pending_approval 动作标为 authorized。"),
    ("填写处理结果 execute", "approved。", "POST /api/cases/:id/execute", "后端把 authorized/executing 动作标为 succeeded，并生成 mock receipt，状态到 executed。"),
    ("确认已完成 close", "executed 或 verified。", "POST /api/cases/:id/close", "后端先到 verified，再到 closed，把 succeeded 动作标为 verified。"),
], widths=[1.55, 1.65, 2.1, 1.75])

heading(doc, "4.4 顶部能力模块", 2)
add_table(doc, ["模块", "前端展示", "后端实际效果"], [
    ("孪生监控", "队列待核对、处理中、已完成、当前风险、事件回放。", "GET 能力快照；只读。"),
    ("本体地图", "报价单、订单、回款、客诉和当前异常的关系图。", "GET 能力快照；只读。"),
    ("报告裁决", "认可结论、要求补材料、退回重新核对。", "POST adjudication 写入 paused 和一条同状态事件；不改变 CaseStatus，也不直接解决 conflicts。"),
    ("推演沙盘", "选择补证、驳回超额索赔或暂缓处理，显示预期影响。", "POST sandbox 校验情景后返回快照；不写案件状态。"),
    ("行动拆解", "查看已有行动、负责人、完成条件、结果。", "GET actions；下方入口只是跳到 resolve。"),
    ("更多能力", "版本对照、人工复核、效果回写、审计等入口。", "POST more 只校验 action 并返回能力列表，当前没有真正执行这些业务动作。"),
], widths=[1.25, 3.45, 2.35])

heading(doc, "五 后端逻辑", 1)
heading(doc, "5.1 请求身份和租户", 2)
add_para(doc, "server.ts 通过 x-tenant-id 读取租户，缺省时使用 demo-tenant-a；通过 x-actor 读取操作者，缺省时根据案件类型使用销售总监或工程师。当前没有登录、会话、签名令牌或服务端角色目录。也就是说，这些 header 在演示环境只是路由参数，不是可信身份。")
add_para(doc, "租户文件名会把不在字母、数字、点、下划线、连字符中的字符替换为下划线。saveCase() 会检查 runtime.tenantId 与请求 tenantId 是否冲突，但请求本身的 tenantId 仍由客户端直接提供。", bold_lead="现状：")

heading(doc, "5.2 ensure 和首次建案", 2)
add_para(doc, "几乎所有案件 API 都先调用 ensure(tenantId, id)。如果租户文件已有该 id，直接返回现有 CaseRecord；否则根据 id 找 GoldCase，执行 openCase() 创建 new 案件，再执行 ingest() 抽取证据、检测冲突、生成缺口和 findings，最后 saveCase()。因此，第一次 GET 案件详情也会产生持久化写入。")
add_para(doc, "首次页面渲染会并行请求案件详情、报告和能力快照，而三个请求都可能触发 ensure()。当前依赖 Node 单进程和简单文件写入，没有显式的初始化锁或原子合并机制。", bold_lead="并发注意：")

heading(doc, "5.3 证据抽取", 2)
add_para(doc, "extractCase() 先确认 tenantId 和 scope 非空；extractMaterial() 对租户或 scope 不匹配的材料返回空数组，对空内容抛出 EMPTY。CSV 通过固定中文表头映射到 field 和 compareKey；Markdown 只识别“型号、数量、金额、告警编号、主机、级别、状态、说明”等行。每条证据包含 sourceId、sourceVersion、locator、quote、confidence、support、tenantId 和 scope。")
add_bullet(doc, "CSV 目前使用按逗号 split 的简化解析，不支持带逗号的引号字段。")
add_bullet(doc, "只有有 fileName 且有 row、line 或 page 的证据才会保留。无 locator 的模型说法不能进入证据事实。")
add_bullet(doc, "checksum() 虽然被调用，但结果没有保存到 EvidencePack；traceId 只是 tr-加案件 ID，不是内容哈希。")

heading(doc, "5.4 冲突和材料缺口", 2)
add_para(doc, "detectConflicts() 只使用 support 为 supported 且有 locator 的证据。它按 compareKey 分组，在不同 sourceId 或 sourceVersion 之间比较值；值不同就生成一个 ConflictPair。对于报价有效期与下单日期、报价状态与订单状态，还存在额外的日期和状态规则。每个冲突目前固定为 resolution: unresolved。")
add_para(doc, "gapsFrom() 当前主要检查 complaint.party 和 complaint.orderId。缺口是 pack.gaps 中的字符串，不是可单独流转的 Gap 状态。findings 则由每个冲突生成，并直接标记为 accepted。")
add_para(doc, "由于是两两比较，同一 compareKey 出现三个或更多不同来源时，会生成多对冲突；因此界面显示的“7 项”不一定等于 7 个独立业务问题。", bold_lead="计数含义：")

heading(doc, "5.5 案件状态机", 2)
add_table(doc, ["当前状态", "允许的下一状态", "含义"], [
    ("new", "triaged", "刚建案，等待分流。"),
    ("triaged", "confirmed 或 rejected", "已分流，确认冲突或驳回。"),
    ("confirmed", "proposed", "冲突已经可以回到来源，允许生成行动草案。"),
    ("proposed", "approved 或 rejected", "行动草案等待负责人确认。"),
    ("approved", "executed", "行动已批准，允许产生执行结果。"),
    ("executed", "verified", "已经有执行回执，等待核验。"),
    ("verified", "closed", "回执核验完成，可以结案。"),
    ("rejected 或 closed", "无", "终态。"),
], widths=[1.2, 1.75, 4.1])
add_para(doc, "assertTransition() 同时要求 actor 和 reason 非空，并检查 TRANSITIONS。actionMayExecute() 只对 approved、executed、verified 返回 true；但 execute() 随后仍会 assertTransition(runtime.status, executed)，因此正常路径真正能从 approved 进入 executed。")

heading(doc, "5.6 各个写操作的真实行为", 2)
add_table(doc, ["函数或 API", "内部步骤", "需要外部 AI 特别检查的点"], [
    ("propose", "new → triaged → confirmed → proposed；按 gold.expectedActionTypes 生成 draft actions。", "没有检查 pack.conflicts、pack.gaps 是否已经被人工解决；只要状态允许就能生成方案。"),
    ("submitForApproval", "draft → pending_approval；追加同状态事件。", "不改变 CaseStatus；函数本身不校验 actor、reason 或当前状态。"),
    ("approve", "校验 actor；proposed → approved；draft/pending_approval → authorized。", "工程师是否应有批准权；actor 来自客户端 header。"),
    ("execute", "审批状态检查；authorized/executing → succeeded；写入 mock-receipt；approved → executed。", "HTTP API 没有接收 idempotencyKey，重复 POST 通常会再次尝试非法状态转移。"),
    ("verifyAndClose", "阻止 authorized/executing；executed → verified → closed；succeeded → verified。", "没有显式阻止 draft 或 pending_approval 动作残留后结案。"),
], widths=[1.45, 3.1, 2.5])

heading(doc, "六 HTTP API 清单", 1)
add_table(doc, ["方法和路径", "用途", "是否写数据", "备注"], [
    ("GET /", "返回内嵌工作台 HTML。", "否", "前端和后端没有独立静态资源层。"),
    ("GET /api/health", "健康检查。", "否", "返回 { ok: true }。"),
    ("GET /api/cases", "返回所有竞赛案件摘要。", "首次建案时可能是", "前端再过滤为 pack=fulfillment。"),
    ("GET /api/cases/:id", "读取案件详情。", "首次访问可能是", "ensure 会首次抽取并保存。"),
    ("GET /api/cases/:id/report", "生成结构化报告。", "首次访问可能是", "报告从当前 runtime 即时生成。"),
    ("GET /api/cases/:id/capabilities/:module", "读取能力模块快照。", "首次访问可能是", "未知 module 会落到 workbench 快照。"),
    ("POST /api/cases/:id/propose", "生成并提交行动草案。", "是", "服务器使用案件 ownerRole 作为 propose actor。"),
    ("POST /api/cases/:id/approve", "负责人批准方案。", "是", "actor 取 x-actor，缺省为销售总监或工程师。"),
    ("POST /api/cases/:id/execute", "执行所有已授权动作。", "是", "一次点击代表当前方案全部动作执行。"),
    ("POST /api/cases/:id/close", "核验回执并结案。", "是", "内部连续完成 verified 和 closed。"),
    ("POST .../capabilities/adjudication", "记录裁决选择。", "是", "只写 paused 和同状态事件。"),
    ("POST .../capabilities/sandbox", "运行只读情景推演。", "否", "校验情景后返回快照。"),
    ("POST .../capabilities/more", "打开更多能力入口。", "当前仅返回", "没有版本、审计或回写的具体实现。"),
], widths=[2.25, 2.15, 1.1, 1.55])

heading(doc, "七 数据落盘和恢复", 1)
add_para(doc, "store.ts 使用 PACK_STORE_DIR，默认是 data/pack-cases。一个租户对应一个 JSON 文件，文件内容是“案件 ID 到 CaseRecord”的对象。saveCase() 先 loadCases()，更新一个 key，再整体 JSON.stringify 写回。没有数据库事务、文件锁、版本号、原子临时文件替换或事件追加日志。")
add_para(doc, "graph.ts 另外提供一个内存中的 Agent 图：Intake、Evidence、Review、Resolution、Verification。runGraph() 可以在指定 Agent 后暂停，resume() 从 pausedAfter 的下一个节点继续，graphLog 记录已经走过的节点。它与 HTTP 工作台不是同一套调用入口，主要由测试和演示使用。")
add_table(doc, ["Agent", "输入", "输出", "停止条件"], [
    ("Intake", "案件与材料清单", "Case.new", "缺 tenant 或 scope 停止"),
    ("Evidence", "GoldMaterial[]", "EvidencePack", "无 locator 不得升格为事实"),
    ("Review", "EvidencePack", "Finding[]", "无证据冲突只记缺口"),
    ("Resolution", "Finding[]", "Action draft", "写操作保持草案"),
    ("Verification", "回执", "Case.closed", "无回执不得关闭"),
], widths=[1.15, 1.8, 1.7, 2.4])

heading(doc, "八 安全闸门和当前逻辑风险", 1)
add_para(doc, "下面不是已经修复的问题，而是基于当前代码应该交给外部 AI 重点复核的清单。请外部 AI 按严重程度重新判断，并指出复现路径。")
add_table(doc, ["优先级", "风险或疑点", "代码依据", "需要确认的问题"], [
    ("P0", "处理层入口规则可能前后端不一致。", "前端 levelState 在 currentLevel=investigate 时允许 resolve；investigate CTA 直接 data-level=resolve。后端 propose 不检查 conflicts/gaps。", "如果业务要求未解决冲突或缺口不能进入处理层，当前实现是否构成绕过？应由哪一层最终拦截？"),
    ("P0", "请求身份不是可信身份。", "tenantOf 和 actorOf 直接读取客户端 header；没有认证和服务端角色目录。", "真实部署时是否可以伪造租户或批准人？哪些 header 必须改为会话或令牌声明？"),
    ("P1", "审批角色判断过宽且代码重复。", "approve() 的条件包含工程师；HTTP 缺省 actor 对履约案件是销售总监。", "工程师是否真的可以批准销售履约动作？缺省 actor 是否应该直接拒绝？"),
    ("P1", "首次页面并行请求可能同时初始化同一案件。", "render() 并行请求 case、report、capability；三条路径都调用 ensure() 和 saveCase()。", "并发写 JSON 是否可能丢更新或互相覆盖？是否需要初始化锁？"),
    ("P1", "重复执行的幂等语义没有贯穿 HTTP API。", "execute() 只有传入 idempotencyKey 时才做已有回执检查；server execute 路由不读取 key。", "网络重试或重复点击时，是否应该返回同一结果而不是非法状态错误？"),
    ("P1", "冲突数量可能被重复计数。", "detectConflicts() 对同组不同来源做两两比较。", "业务上要统计独立问题、来源对数，还是所有差异对？"),
    ("P1", "证据解析能力有限。", "parseCsv() 直接 split(',')；checksum 结果丢弃。", "包含逗号、换行、引号、附件或真实表格时会不会错读？证据哈希和版本是否足够可追溯？"),
    ("P1", "裁决模块没有反馈到主状态机。", "adjudication POST 只写 paused 和同状态事件，不解决 conflicts/gaps，也不改变状态。", "用户点击“认可当前结论”后，为什么仍不能明确进入下一阶段？是否需要正式裁决状态？"),
    ("P2", "结案前的动作状态校验不完整。", "verifyAndClose() 只拦 authorized 和 executing，没有显式拦 draft/pending_approval。", "是否存在残留未审批动作但仍可结案的路径？"),
    ("P2", "更多能力当前是占位入口。", "more POST 只返回 capability list，前端只弹 toast。", "外部展示时是否要明确标注“演示入口”，避免被理解为已实现？"),
    ("P2", "报告结论可能与中间状态语义不一致。", "buildReport() 对所有非 closed 状态都使用“现在还不能直接按方案处理”。", "approved、executed、verified 状态是否应该显示不同结论？"),
    ("P2", "文件存储不具备生产级并发和恢复能力。", "loadCases + 修改对象 + writeFileSync 整体覆盖。", "多个用户或多个进程同时写时如何避免丢失？异常中断时如何恢复？"),
], widths=[0.55, 1.85, 2.75, 2.2])

heading(doc, "九 已验证事实和未验证事实", 1)
add_table(doc, ["类别", "当前证据", "可以怎么说", "不能怎么说"], [
    ("自动化测试", "npm test：24/24；typecheck 通过。", "当前单元和白盒契约通过。", "不能等同于生产可用。"),
    ("评测", "30 个合成案件；negativeFailures=[]；failures=[]；conflicts 17/18。", "当前金标准评测没有负向失败。", "不能说客户生产准确率 17/18。"),
    ("流程", "FX-001 可从 new 走到 closed，并生成模拟回执。", "演示闭环已跑通。", "不能说真实动作已执行。"),
    ("来源", "证据含 locator 和 quote；无 locator 的 unsupported 不进入冲突。", "具备演示级来源回指。", "不能说已经接入真实检索或 OCR。"),
    ("权限", "代码中有 actor 参数和有限角色判断。", "具备状态机层面的角色概念。", "不能说已有真实身份认证和授权。"),
    ("商业效果", "humanEditRate 为 unverified，timeSaved 为 hypothesis。", "这些指标尚未验证。", "不能宣称节省工时、ROI 或客户收益。"),
], widths=[1.05, 2.15, 2.1, 2.05])

heading(doc, "十 请外部 AI 这样审查", 1)
add_para(doc, "请把本文件连同项目源代码一起交给外部 AI，并要求它只基于代码和测试证据判断，不要凭经验补齐不存在的功能。")
add_para(doc, "审查任务：请逐条复核前端状态、HTTP API、案件状态机、EvidencePack、冲突检测、动作审批、执行幂等、租户隔离、文件存储和能力模块。对每个问题输出：严重程度、复现步骤、涉及文件和函数、当前行为、期望行为、修复建议、是否需要新增测试。", bold_lead="建议提示词：")
add_number(doc, "前端的 overview、investigate、resolve 三层入口是否与后端允许的状态完全一致？是否存在按钮 disabled 但其他 CTA 可以绕过的路径？")
add_number(doc, "pack.conflicts 和 pack.gaps 在什么条件下必须阻止 propose？当前后端是否真正执行了这个业务规则？")
add_number(doc, "客户端可控的 x-tenant-id 和 x-actor 是否会造成越权、跨租户读取或伪造审批？")
add_number(doc, "并行 GET 首次初始化同一案件时，JSON 文件是否可能丢失写入？如何设计原子初始化？")
add_number(doc, "重复 POST execute、网络重试和多动作执行是否满足幂等？HTTP API 是否应该接收并返回幂等键？")
add_number(doc, "detectConflicts 的两两比较是否符合业务统计口径？是否会产生重复冲突或错误关联？")
add_number(doc, "CSV、Markdown、locator、confidence、support 和 checksum 是否足以支撑可审计证据？")
add_number(doc, "approve、execute、verifyAndClose 的权限和动作状态是否可能出现非法组合？")
add_number(doc, "裁决、沙盘、更多能力模块的界面承诺是否与后端真实副作用一致？")
add_number(doc, "哪些问题是演示限制，哪些问题在生产化时必须修复？请按 P0、P1、P2 分组。")

heading(doc, "十一 代码索引", 1)
add_table(doc, ["文件", "主要职责"], [
    ("src/workbench/index.html", "页面结构、样式、前端状态、API 调用、渲染、按钮门禁和能力模块。"),
    ("src/server.ts", "HTTP 路由、租户和 actor 读取、ensure、能力快照和动作接口。"),
    ("src/types.ts", "Evidence、Conflict、Finding、Action、CaseRecord、GoldCase 类型。"),
    ("src/evidence/extract.ts", "CSV/Markdown 证据抽取、locator、租户 scope 检查和 unsupported 处理。"),
    ("src/conflict/detect.ts", "冲突配对、日期/状态特例和材料缺口。"),
    ("src/case/runtime.ts", "状态机、提案、审批、执行、核验结案和 happy path。"),
    ("src/store.ts", "按租户 JSON 文件读取和整体写回。"),
    ("src/report/build.ts", "从当前案件生成报告、事实、冲突引用和结论。"),
    ("src/agents/graph.ts", "Intake 到 Verification 的内存 Agent 图、暂停和恢复。"),
    ("src/eval/run.ts", "30 个合成案件的事实、冲突、动作和负向评测。"),
    ("tests/pack.test.ts", "状态机、证据、负向场景、Agent 恢复和报告测试。"),
    ("tests/workbench-ui.test.ts", "前端文案、层级、门禁和响应式白盒契约。"),
], widths=[2.2, 4.85])

heading(doc, "十二 当前结论", 1)
add_para(doc, "这是一条适合比赛演示和逻辑审查的最小闭环：它能把合成履约异常转成可回源证据、冲突、待审批动作和模拟回执。它目前最值得外部 AI 检查的不是页面是否好看，而是“前端可见入口、后端状态机、身份信任边界、冲突解决语义和持久化并发”这五条线是否一致。")
add_para(doc, "如果外部 AI 只给出“代码结构清晰”之类的泛泛评价，请要求它按第十节的十个问题逐条给出文件、函数、复现路径和测试建议。")

doc.save(OUT)
print(OUT)
