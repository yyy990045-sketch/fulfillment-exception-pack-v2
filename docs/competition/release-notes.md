# 参赛发布说明

版本 `0.1.0`，发布线 `competition-candidate-pre-1.0`。标签名 `competition-v0.1.0`。

## 问题

跨系统履约数字对不上：订单承诺和完工数量不一致时，需要发现差异、回到来源证据，再由人决定是否执行。

## 现在能用什么

- 主场景 `production-shortfall`。
- 证据回源，以及证据被破坏时审批和执行被挡住。
- 仿真多系统事件、UNS 语义映射、重放不产生重复异常。
- 职责分离、执行回读、备份校验和恢复演练。
- 依赖许可证检查、SBOM 和参赛交付包。

## 怎么跑

```bash
npm install
npm run demo:judge
```

核心演示不需要 Docker、Superset、Power BI、open supOS、JEV 或真实 MQTT。

核对证据：

```bash
npm run evidence:verify -- --context <demo 输出的 contextId>
```

## 已经在本地验证的

- 评委主场景可以重复跑通。
- 证据链、证据破坏闸门、重放幂等、备份和恢复。
- 依赖许可证元数据全部落在允许集合内。项目自身的许可证仍未选定。
- SBOM 由当前锁文件生成，覆盖后端和前端这一个 npm 工程。

## 仿真的部分

工业事件、来源系统和工厂日历来自本地仿真。`SIMULATED INDUSTRIAL ENVIRONMENT` 不是真实工厂。

## 仍在外部、本环境没有验证的

- 真实客户、真实工厂、真实 MES、生产部署。
- open supOS 真实运行时。连接器已实现，UNS/MQTT 契约只在本地验证。
- Superset 嵌入代码已实现，此前有本地仪表板记录；当前环境的嵌入检查被环境挡住。
- Power BI 和 JEV 的真实运行时。JEV 提供者层面的工作不能写成真实客户决策质量已验证。

## 已知限制

- 项目许可证需要所有人决定。交付包里是 `LICENSE_DECISION_REQUIRED`，不是一份选定的许可证。
- 没有容器 SBOM。本次不安装 Syft，也不为了 SBOM 构建镜像。
- 没有 GitHub Actions 发布流水线。
- 历史交接文档里还有公网地址，公开前应清理。那不是密钥。
