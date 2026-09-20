# 验证记录

目标：远程验收准备 + A/B 缺口封口。本轮不碰 Superset / Power BI / Jev，不在 macOS 上启动 open supOS。

A/B（同一条 Connector 入口）：
- `ab-cases.ts`：normal-order（全一致）与 exception-order（仅生产完成 96 < 订单 100），各 11 条 UNS 消息
- `connector.ts`：OpenSupOSUnsQueue（checkpoint cursor=occurredAt#messageId）→
  OpenSuposInboundConnector.readPage → runInboundSync（Source Ledger / cursor / 重放 / 幂等）
- `contract-verify.ts`：A/B 断言 + replay + checkpoint + ledger provenance

证据（本地契约）：
- `npm run open-supos:verify -- --mode contract` → PASS / LOCAL_CONTRACT_VERIFIED（exit 0）
  Case A: evaluations=7 matched=0 exceptions=0
  Case B: evaluations=7 matched=1 exceptions=1 codes=ORDER_PRODUCTION_COMPLETION_SHORTFALL
  replay: duplicateInput=11 newLedger=0 newEvents=0 newExceptions=0
  checkpoint: checkpointRecordsRead=0
- `npm run open-supos:verify -- --mode live` → BLOCKED / exit 1（本机正确行为，20 项全部可见）

远程准备：
- scripts/open-supos-remote-preflight.sh → 本机 BLOCKED_BY_HOST exit 2（arch=arm64 / os=Darwin），只读
- scripts/open-supos-remote-bootstrap.sh → preflight 不通过即停止，未创建任何目录
- scripts/open-supos-remote-verify.sh → 固定 20 步编排，缺配置/缺证据即 FAIL，不输出 VERIFIED
- deploy/open-supos/.env.remote.example（只有变量名；真实值 .env.remote 已 gitignore）
- docs/open-supos-remote-runtime-runbook.md（新机器可独立完成）

测试：
- npm test 398/398、frontend:test 64/64、frontend:e2e 6/6、typecheck、eval、git diff --check 全通过
- superset:verify-embed 22/22（未回归 Superset 链路）
- live 相关真值保持 false；新增 OPEN_SUPOS_AB_CONTRACT_VERIFIED / OPEN_SUPOS_REMOTE_RUNBOOK_READY = true
