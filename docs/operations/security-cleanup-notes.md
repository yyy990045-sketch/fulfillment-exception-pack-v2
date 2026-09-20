# Security cleanup notes

本轮（Production Operations & Recovery Seal）对仓库做了一次只读敏感信息扫描。

## 扫描结论

```text
真实密码        : 未发现
token / JWT     : 未发现（只有字段名与环境变量名）
private key     : 未发现
Authorization   : 未发现（测试与文档里只有占位或红acted 样例）
```

命中的都是**变量名/引用**，不是值，例如：

```text
deploy/superset/docker-compose.yml   POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
deploy/superset/superset_config.py   os.environ["POSTGRES_PASSWORD"]
src/integrations/**/config.ts        values.SUPERSET_SERVICE_PASSWORD!
```

这些属于必须存在的配置入口，保持现状（值全部来自 gitignored 的 `.env*` 或部署环境变量）。

## 待清理项（本轮**未**修改，按要求不动 Git 历史）

```text
docs/交接给外部AI-代码与部署说明.md
  - 含历史公网 IP 与 SSH 登录目标（4 处：主机、SSH 目标、scp/ssh 示例）
  - 属于「普通基础设施地址」，不是 credential，因此没有触发立即停止
  - 建议后续单独一次最小改动：把 IP/登录目标替换为 <REMOTE_HOST>/<SSH_USER>，
    并同步检查该文档是否仍需要对外交付
```

处置原则：

```text
不改 Git 历史（不做 filter-branch / rebase）
不在本轮顺手改这份历史交接文档（它属于另一条主线的内容）
若后续确认该地址已废弃，再单独清理，并在提交信息里说明范围
```

## 本项目自身的卫生约定

- 所有真实值只放 gitignored 的 `.env*` / `.env.remote` / `deploy/superset/.env`
- `.preview/`（截图、演练产物、preflight 记录）整体 gitignored，且记录内容不含 IP/用户名
- 结构化日志与安全审计在写出前对 authorization/cookie/jwt/password/secret/token 递归脱敏
- 备份 manifest 与 `ops/status` 只包含版本、大小、schema 与 configured/unconfigured 状态
