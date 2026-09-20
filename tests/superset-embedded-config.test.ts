import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");

/**
 * 嵌入看板 403 的真实根因回归护栏。
 *
 * 1) Superset 的 guest token 只用 GUEST_ROLE_NAME 一个 role 授权，官方默认
 *    "Public" 在 `superset init` 之后没有任何权限 → 嵌入应用 /api/v1/* 全量 403。
 *    所以配置必须显式绑定专用 role，且不能退化成 Public / Gamma / Admin。
 * 2) Superset 只在 PUT 的 json_metadata.positions 里同步 dashboard ↔ chart 关联，
 *    只写 position_json 会让 dashboard_slices 为空，看板渲染成空白。
 */
describe("Superset 嵌入配置", () => {
  const config = read("deploy/superset/superset_config.py");
  const compose = read("deploy/superset/docker-compose.yml");
  const setup = read("scripts/superset-setup.mjs");
  const roleInit = read("deploy/superset/init/02-embedded-role.py");
  const entrypoint = read("deploy/superset/init/01-init.sh");

  it("显式设置 GUEST_ROLE_NAME，且不落在 Public / Gamma / Admin 上", () => {
    expect(config).toMatch(/^GUEST_ROLE_NAME\s*=/m);
    const assignment = /^GUEST_ROLE_NAME\s*=\s*(.+)$/m.exec(config)?.[1] ?? "";
    expect(assignment).toContain("SUPERSET_GUEST_ROLE_NAME");
    expect(assignment).not.toMatch(/"Public"/);
    expect(assignment).not.toMatch(/"Gamma"/);
    expect(assignment).not.toMatch(/"Admin"/);
  });

  it("compose 把专用 role 名注入容器", () => {
    expect(compose).toMatch(/SUPERSET_GUEST_ROLE_NAME:\s*\$\{SUPERSET_GUEST_ROLE_NAME:-EmbeddedGuest\}/);
  });

  it("role 初始化脚本按 permission/view_menu 查找，且不授予越权权限", () => {
    expect(roleInit).toMatch(/find_permission_view_menu\(/);
    // 白名单里只允许出现只读权限；all_datasource_access 只能在说明文字里出现，不能出现在授权列表
    for (const forbidden of ["all_datasource_access", "can_write", "can_add", "can_delete", "can_edit", "can_grant_guest_token"]) {
      expect(roleInit).not.toContain(`("${forbidden}"`);
    }
    expect(entrypoint).toContain("02-embedded-role.py");
  });

  it("dashboard 通过 json_metadata.positions 关联 chart，避免空白看板", () => {
    expect(setup).toMatch(/positions/);
    expect(setup).toMatch(/json_metadata:\s*JSON\.stringify\(\{[\s\S]*positions/);
  });

  it("不使用被否定的『修好 403』手段", () => {
    expect(config).not.toMatch(/WTF_CSRF_ENABLED\s*=\s*False/);
    expect(config).not.toMatch(/CORS|allow_headers/);
    expect(compose).not.toMatch(/all_datasource_access/);
  });
});
