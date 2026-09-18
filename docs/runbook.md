# 一键演示 Runbook

本 Runbook 对应最终代码版本；执行结果写入本地能力台账，Docker 部署使用 SQLite 持久卷。

演示环境：Node 22.5+，本机 loopback；生产 SQLite 后端与 Docker 镜像使用 Node 24。

```bash
cd /Users/xieweikai/Projects/fulfillment-exception-pack
npm install
npm test
npm run eval
npm run demo
```

浏览器打开 `http://127.0.0.1:3410`，页面默认只显示销售履约案件。

生产启动时必须额外设置 `NODE_ENV=production DEMO_MODE=false AUTH_SECRET=<由密钥管理器注入的32字节以上密钥> PACK_STORE_BACKEND=sqlite PACK_STORE_DB=/app/data/pack-cases.sqlite`；可从仓库根目录 `.env.production.example` 开始配置。生产请求使用包含 `sub`、`tenant_id`、`roles`、`scopes`、`exp` 的 HS256 bearer JWT。

五分钟操作：

1. 左侧默认 FX-001。
2. 在「异常概览」看结论：报价数量 100、订单数量 80。
3. 点「开始核对 7 处差异」，在差异卡中逐项展开「查看依据」，再点每项「标记已核对」。
4. 7 处差异全部核对后，点「进入处理阶段」，再点「开始拟定处理方案」→「提交负责人确认」→「登记处理结果」→「确认处理完成并结案」。
5. 时间线必须出现 approved / executed / verified / closed。
6. 不要打开生产 CRM，不要用真实回单。

故障：

- 端口占用：`PORT=3411 npm run demo`
- 处理阶段仍锁定：检查是否还有差异未标记为「已核对」，或案件是否有待补材料
- 批准按钮报错：先点「开始拟定处理方案」
- 结案报错：先点「登记处理结果」
