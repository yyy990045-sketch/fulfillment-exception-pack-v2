# Repository governance audit

本文件记录参赛封口时的治理审计。状态只用：`EXISTS`、`INCOMPLETE`、`MISSING`、`CONFLICT`。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| LICENSE | MISSING | 没有足够依据选定许可证。见 `license-audit.md`。不补一份假的许可证 |
| NOTICE | MISSING | 许可证未定，也没有发现随仓库分发的上游源码。不提前编写 NOTICE |
| README.md | EXISTS | 保留原有安装和 `npm run demo:judge`。主架构链与一页架构一致 |
| CONTRIBUTING.md | EXISTS | 写的是本仓库真实的环境、分支、测试和事实边界 |
| CODE_OF_CONDUCT.md | EXISTS | Contributor Covenant 2.1 原文。没有公开邮箱 |
| SECURITY.md | EXISTS | 使用 GitHub 私密安全通告。没有公开邮箱 |
| CHANGELOG.md | EXISTS | 按阶段整理。不声称完整遵循某一变更日志规范 |
| Issue templates | EXISTS | bug、feature、integration |
| Pull request template | EXISTS | 含测试、安全、租户、事实标记和集成验证方式 |
| Dependency license report | EXISTS | `docs/open-source/third-party-dependencies.md` |
| SBOM | EXISTS | `artifacts/sbom.cdx.json`，CycloneDX JSON，覆盖同一个 npm 锁文件里的后端和前端 |
| Container SBOM | MISSING | 本机没有 syft，本次也不构建镜像。不因此挡住 Node SBOM |
| Release workflow | MISSING | `.github/workflows/` 不存在。本次不新造发布流水线 |
| Version | EXISTS | `0.1.0`，语义是参赛候选 / pre-1.0 |
| Git tag | MISSING | 审计开始时没有标签。验收通过后的标签是 `competition-v0.1.0` |

没有发现许可证文件和包声明互相矛盾。阶段 1 架构文档与当前主链不是两套现行架构：该文档保留为历史记录，当前主链只以 README 和 `docs/competition/architecture-one-page.md` 为准。

历史交接文档里仍有公网地址和 SSH 目标。那不是凭据。公开仓库前应删掉。秘密扫描不会把这个地址当成密钥。
