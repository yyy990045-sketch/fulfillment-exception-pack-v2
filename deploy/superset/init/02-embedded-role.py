#!/usr/bin/env python
"""幂等创建 / 收敛嵌入看板专用的最小权限 role（默认名 EmbeddedGuest）。

为什么需要这个 role
-------------------
Superset 的 guest token 只用 `GUEST_ROLE_NAME` 这一个 role 授权
（superset/security/manager.py `get_guest_user_from_token`）。官方默认值是
`"Public"`，而 `"Public"` 在 `superset init` 之后**没有任何权限**，
于是嵌入应用启动时的 `/api/v1/me/`、`/api/v1/me/roles/`、
`/api/v1/dashboard/<id>/charts` 全部 403，iframe 里只剩空白 dashboard。

这个脚本为嵌入场景建立专用 role，只给嵌入看板真正需要的只读权限：

  * CurrentUserRestApi / Dashboard / Chart / Dataset 的 can_read
    （`/api/v1/me/`、`/api/v1/me/roles/`、`/api/v1/dashboard/<id>`、
     `/api/v1/dashboard/<id>/charts`、`/api/v1/dashboard/<id>/datasets`、
     `POST /api/v1/chart/data`）
  * 当前 analytics 事实表的 datasource_access（逐表授予，不做 all_datasource_access）

明确不授予：Gamma / Admin、`all_datasource_access`、任何 write / add / delete、
SQL Lab、database admin、`can_grant_guest_token`。

权限一律按 (permission name, view menu name) 查找，不写死主键 ID。
重复执行不会产生重复项，并会把 role 收敛回上面这份白名单。
"""

from __future__ import annotations

import argparse
import os
import sys

from superset.app import create_app

# 嵌入看板在浏览器里真正会打到的只读权限；每条都必须已存在于 metadata，
# 找不到就直接失败，绝不按名字伪造一条 permission_view_menu。
REQUIRED_PERMISSION_VIEW_MENUS: tuple[tuple[str, str], ...] = (
    ("can_read", "CurrentUserRestApi"),
    ("can_read", "Dashboard"),
    ("can_read", "Chart"),
    ("can_read", "Dataset"),
)

# 允许 guest 访问的 dataset 白名单（analytics 库的 4 张事实表）
DATASET_WHITELIST: tuple[str, ...] = (
    "fact_exception_type",
    "fact_resolution_stage",
    "fact_rule_performance",
    "fact_source_system",
)

ROLE_NAME = os.environ.get("SUPERSET_GUEST_ROLE_NAME", "EmbeddedGuest")


def log(message: str) -> None:
    print(f"[fep-superset][embedded-role] {message}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-missing-datasets",
        action="store_true",
        help=(
            "容器首次初始化时投影尚未导入，此时只保证 4 条基础只读权限，"
            "不改动任何 datasource_access。"
        ),
    )
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        from superset import db, security_manager as sm
        from superset.connectors.sqla.models import SqlaTable

        role = sm.find_role(ROLE_NAME)
        if role is None:
            role = sm.add_role(ROLE_NAME)
            log(f"created role {ROLE_NAME}")
        else:
            log(f"role {ROLE_NAME} already exists")

        desired: dict[tuple[str, str], object] = {}
        for permission_name, view_menu_name in REQUIRED_PERMISSION_VIEW_MENUS:
            permission_view = sm.find_permission_view_menu(permission_name, view_menu_name)
            if permission_view is None:
                raise SystemExit(
                    f"[fep-superset][embedded-role] FATAL: metadata 中不存在 "
                    f"'{permission_name}' on '{view_menu_name}'；"
                    "不要按名字伪造权限，请先确认 Superset 版本与 metadata 状态。"
                )
            desired[(permission_name, view_menu_name)] = permission_view

        datasets = (
            db.session.query(SqlaTable)
            .filter(SqlaTable.schema == "analytics")
            .filter(SqlaTable.table_name.in_(DATASET_WHITELIST))
            .all()
        )
        found = {table.table_name for table in datasets}
        missing = sorted(set(DATASET_WHITELIST) - found)
        if missing:
            if not args.allow_missing_datasets:
                raise SystemExit(
                    "[fep-superset][embedded-role] FATAL: analytics 库缺少事实表 "
                    f"{missing}；请先导入投影（npm run superset:export）并建好 dataset，"
                    "或显式使用 --allow-missing-datasets。"
                )
            log(
                f"WARN: 投影尚未导入，缺少事实表 {missing}；"
                "本次只收敛基础只读权限，datasource_access 保持原样。"
            )
        for table in datasets:
            permission_view = sm.find_permission_view_menu("datasource_access", table.perm)
            if permission_view is None:
                raise SystemExit(
                    f"[fep-superset][embedded-role] FATAL: metadata 中不存在 "
                    f"'datasource_access' on '{table.perm}'。"
                )
            desired[("datasource_access", table.perm)] = permission_view

        current = {(pv.permission.name, pv.view_menu.name): pv for pv in role.permissions}

        added = sorted(key for key in desired if key not in current)
        # 投影未导入时不动 datasource_access，避免把已收敛好的授权删掉
        keep_untouched = (missing and args.allow_missing_datasets)
        removed = sorted(
            key
            for key in current
            if key not in desired and not (keep_untouched and key[0] == "datasource_access")
        )
        for key in added:
            sm.add_permission_role(role, desired[key])
        for key in removed:
            sm.del_permission_role(role, current[key])
        db.session.commit()

        for permission_name, view_menu_name in sorted(desired):
            log(f"granted {permission_name} on {view_menu_name}")
        for permission_name, view_menu_name in removed:
            log(f"revoked {permission_name} on {view_menu_name}")
        log(
            f"done: role={ROLE_NAME} permissions={len(role.permissions)} "
            f"added={len(added)} removed={len(removed)}"
        )
        if not any(name == "all_datasource_access" for _, name in desired):
            log("all_datasource_access NOT granted (by design)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
