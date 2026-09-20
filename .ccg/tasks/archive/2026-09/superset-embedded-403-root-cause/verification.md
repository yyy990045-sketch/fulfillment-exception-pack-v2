# 验证记录

根因（两个，均为配置/装配问题）：
1. `GUEST_ROLE_NAME` 落在官方默认 `Public`，而 `Public` 在 `superset init` 后 0 条权限
   → 嵌入应用 `/api/v1/me/`、`/api/v1/me/roles/`、`/api/v1/dashboard/<id>/charts` 全量 403。
   Gamma 对照实验后确认，最终使用专用最小权限 role `EmbeddedGuest`。
2. dashboard ↔ chart 关联从未建立（`dashboard_slices` 为空）
   → 权限修好后 `/charts` 返回 200 但空数组，看板仍是空白。
   修复：`json_metadata.positions`（`set_dash_metadata` 的唯一同步入口）。

证据：
- `.preview/superset/guest-role-audit.txt`（容器内运行时审计，Public=0 权限）
- `npm run superset:init-role` 重复执行 `added=0 removed=0`
- `docker compose down && docker compose up -d` 全自动 bootstrap 成功，无需点 Superset UI
- `npm run superset:verify-embed` 22/22 PASS（含 chart data 真实行、租户/scope 边界、越权拒绝）
- ego-browser 真实浏览器 `http://127.0.0.1:3411/analytics`：4 个模块全部渲染，无 Data error；
  截图 `.preview/superset-live/analytics-superset-{1440,1600}.png`（四象限非白像素 7.5%–25%，
  修复前同位置约 1%）
- `npm test` 384/384、`npm run frontend:test` 64/64、`npm run frontend:e2e` 6/6、
  `npm run typecheck`、`npm run eval`、`git diff --check` 全部通过

未声明：生产部署、多租户 RLS、客户验收、HA。
