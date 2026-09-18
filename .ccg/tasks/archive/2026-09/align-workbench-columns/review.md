# Review

## Critical

无。

## Warning

无。桌面端左右栏在同一网格行内严格对齐，左栏独立滚动；移动端恢复自然文档流。

## Info

- 应用壳改为 `auto + minmax(0, 1fr)` 两行网格，工作区占满剩余视口。
- 右侧正文保持独立滚动，二级长表格不会把左侧案件队列再次撑长。
- 公网 Playwright：桌面 queue/content top 均为 80.5，bottom 均为 1000；移动端无横向溢出；控制台错误 0。
- 本地 `npm test`：22/22；`npm run typecheck`：通过。
