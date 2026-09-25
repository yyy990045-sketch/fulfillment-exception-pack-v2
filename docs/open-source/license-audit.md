# License decision audit

Status: `LICENSE_DECISION_REQUIRED`

本仓库没有 `LICENSE`、`NOTICE`，`package.json` 也没有 `license` 字段。`private: true` 只表示不发布到 npm，不是开源许可证。本次封口不选择 MIT 或 Apache-2.0。

仓库内没有找到比赛方指定许可证的记录。在所有人明确决定之前，不能把项目说成已经采用某种开源许可证。

## 仓库内材料

| 检查项 | 结果 |
| --- | --- |
| 项目许可证文件 | 没有 |
| `package.json` 许可证字段 | 没有 |
| `src/`、`frontend/`、`scripts/`、`deploy/` 中的版权头或 SPDX 头 | 没有发现复制来的上游版权声明 |
| `vendor/` 或随仓库携带的第三方源码目录 | 没有 |
| open supOS adapter | 本仓库自己的接入代码。阶段文档写明没有修改上游源码。未发现把 open supOS 上游源码拷进仓库 |
| Superset | HTTP API 客户端，外加 npm 依赖 `@superset-ui/embedded-sdk`。不是 Superset 服务端源码 |
| Power BI | 官方客户端库的 API 集成 |
| `submission/` | 空目录 |

## 候选

| 候选 | 与当前依赖的关系 | 义务和风险 |
| --- | --- | --- |
| MIT | 与当前已识别的宽松依赖不冲突 | 需要保留版权和许可证声明。不能自动覆盖将来拷入的上游代码 |
| Apache-2.0 | 与当前已识别的宽松依赖不冲突 | 需要保留声明、许可证文本，并在适用时提供 NOTICE。专利条款和贡献约定需要所有人确认 |
| 暂不选择 | 与现状一致 | 拿到仓库的人没有被授予使用许可。参赛包不能声称已经选定开源许可证 |

## 依赖侧需要单独记住的义务

依赖许可证审计见 `docs/open-source/third-party-dependencies.md`。下面几类已经被识别，允许进入依赖检查，但不构成项目许可证决定：

- `MPL-2.0`：`lightningcss` 及其平台包，来自前端构建链，仓库没有修改这些文件。
- `CC-BY-4.0`：`caniuse-lite`。署名义务随 npm 包走，竞赛包不包含 `node_modules`。
- `Python-2.0`：传递依赖 `argparse`。
- `(MIT OR CC0-1.0)`：`type-fest`。

`npm` 元数据缺失会记为 `UNKNOWN`，不会被当成允许使用。当前锁文件没有这种缺失。

## 仍需所有人决定

- 项目采用哪一份许可证，或继续保持未授权。
- 是否需要 `NOTICE`。在许可证选定、并且确认没有需要单独声明的拷入代码之前，不新增 `NOTICE`。
- `submission/` 如果以后放入第三方材料，要单独确认能否再分发。

依赖许可检查可以在项目许可证未定的情况下通过，输出 `LICENSE_AUDIT_VERIFIED`，同时保留 `LICENSE_DECISION_REQUIRED`。未知依赖许可仍会使检查失败并输出 `LICENSE_AUDIT_BLOCKED`。
