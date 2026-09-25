# Changelog

版本按阶段记录这个参赛仓库里已经落地的主要能力。分节方式参考常见变更日志，但没有逐条执行某一份规范的全部要求，因此不声称遵循该规范。

当前版本是参赛候选 / pre-1.0，不是 1.0.0 production。

## [0.1.0] - 参赛候选

### Core

履约上下文、来源账本、确定性异常检测，以及从异常到处置的主链路。

### Evidence

证据回源、留存载荷哈希、回源闸门。证据不可回源时不把结果当成已验证。

### Governance

人工受理、提交和另一人批准。职责分离会拒绝同一个人批准自己提交的方案。

### Decision

证据约束下的解释和推荐。AI 不批准、不执行。

### Connector Runtime

连接器运行时、游标和对外投递边界。可选外部系统不是核心演示的前提。

### Manufacturing Pack

制造履约场景、规则目录，以及销售承诺和完工数量之间的差异识别。

### open supOS

入站连接器和 UNS/MQTT 契约可以在本地验证。真实 open supOS 运行时未验证。

### Superset

嵌入路径已经实现。此前有本地仪表板验证记录。当前环境没有重新跑通这项检查。

### Security

租户隔离、角色边界，以及生产模式和演示模式的认证区别。

### Operations

备份校验和恢复演练。

### Industrial Simulator

高保真仿真工业环境和 UNS 语义层。仿真结果不是真实工厂。

### Judge Demo

主场景 `production-shortfall`。命令是 `npm run demo:judge`。

### Open-source release

依赖许可证清单、CycloneDX SBOM、参赛清单、只读环境检查、验收命令、干净目录复现和交付包校验。项目许可证仍未选定。
