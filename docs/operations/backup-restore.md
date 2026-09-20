# 备份与恢复手册

## 为什么不能直接 `cp`

业务库使用 WAL 模式，已提交事务可能还在 `-wal` 里。单独复制 `.sqlite` 文件会得到
**缺少最近已提交数据**或损坏的副本。因此本项目统一使用 SQLite 自身的
`VACUUM INTO` 生成一致性快照，并对快照做 `PRAGMA integrity_check` 与 sha256。

## 备份：`npm run db:backup`

```bash
PACK_STORE_DB=<业务库路径> npm run db:backup            # 默认写到 ./backups
PACK_STORE_DB=<路径> npm run db:backup -- --out /data/backups
```

产出：

```text
backups/
  20260920-201530/
    pack-cases.sqlite       # VACUUM INTO 一致性快照
    manifest.json
```

manifest 字段：

```json
{
  "createdAt": "...",
  "schemaVersion": "018_security_audit_events",
  "sourceDb": "/abs/path/pack-cases.sqlite",
  "backupFile": "/abs/path/20260920-201530/pack-cases.sqlite",
  "size": 614400,
  "sha256": "…",
  "applicationVersion": "0.1.0"
}
```

manifest **不含** JWT / secret / password。

## 恢复：`npm run db:restore`

```bash
npm run db:restore -- --from backups/20260920-201530 --to /data/pack-cases.sqlite
# 覆盖已存在的目标必须显式确认
npm run db:restore -- --from backups/20260920-201530 --to /data/pack-cases.sqlite --force
```

安全规则（全部实现并有测试）：

```text
--from / --to 必填，否则 RESTORE_ARGUMENTS_REQUIRED
目标已存在且没有 --force → RESTORE_TARGET_EXISTS（默认拒绝）
目标与源相同 → RESTORE_TARGET_EQUALS_SOURCE
sha256 与 manifest 不一致 → RESTORE_CHECKSUM_MISMATCH
源或目标的 SQLite 完整性检查失败 → RESTORE_BACKUP_INTEGRITY_FAILED / RESTORE_TARGET_INTEGRITY_FAILED
备份 schema 高于当前应用支持（无 unknown 版本）→ RESTORE_SCHEMA_UNSUPPORTED
恢复后首次打开只做 forward migration，不会 downgrade、不会重建
```

## 恢复验证：`npm run db:verify-backup`

不满足于“文件复制成功”。全程在临时目录内：

```text
seed 真实业务数据（Context / Exception / Evidence / Resolution / Audit Event）
→ 一致性快照
→ 新空 target
→ restore
→ 打开 restored DB
→ 比较数量与关键 ID（context / exception / audit）
→ PRAGMA integrity_check
→ migration status
```

全部 PASS 时输出 `BACKUP_RESTORE_VERIFIED`。

## 保留策略

```bash
BACKUP_RETENTION_COUNT=7   # 默认 7；只保留最新的 N 份
```

安全约束（`pruneBackups`）：

```text
只处理 <BACKUP_DIR> 下形如 YYYYMMDD-HHMMSS 的直接子目录
realpath 必须仍位于 BACKUP_DIR 内，且目录名与 realpath 基名一致
symlink 指到外部的目录一律拒绝（refused），不删除
只删自己的备份目录，不做任何递归通配删除
```

若判定不安全（例如目录被替换成 symlink），该条目会被列入 `refused` 并保留。

## Migration 备份门

```bash
npm run db:migrate           # 若库已存在且有 pending migration，先自动做一致性备份再迁移
npm run db:migrate -- --skip-backup
npm run db:migrate:status    # 只读：current / supported / pending / unknown / duplicates
```

迁移只会 forward；出现 unknown（更高版本）或 duplicate 版本时状态命令返回非 0，
服务启动也会直接失败。

## 已知限制

- 备份是**同一台机器**上的目录，没有异地/对象存储；生产应把 `BACKUP_DIR` 挂到独立卷或同步出去
- 没有定时任务；请用 cron/systemd timer 调 `db:backup`
- 没有 PITR（无法恢复到任意时间点），RPO = 最近一次成功备份
- 恢复是整库替换，不支持单表/单租户回滚

## 复现

```bash
npm run db:verify-backup
npm test -- tests/ops-runtime.test.ts
```
