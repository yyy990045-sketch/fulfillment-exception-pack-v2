# 灾难恢复演练（recovery drill）

```bash
npm run ops:recovery-drill
```

脚本自动执行 12 步，全部在 **临时目录** 内完成；一旦解析出的路径不在临时工作区内会立即失败退出。
**默认业务库（`PACK_STORE_DB` / `data/`）不会被读写或删除。**

## 12 步与判定

```text
01 seed isolated DB      用真实领域 API 造 Context / Exception / Evidence / Resolution / Audit
02 create backup         VACUUM INTO 一致性快照 + manifest(sha256)
03 checksum              重算 sha256 必须一致
04 corrupt / remove      删除工作副本（模拟磁盘事故）
05 restore to new DB     走 db-restore CLI（含 checksum / integrity / schema 校验）
06 start app             用 restored DB 启动真实服务（demo 模式 + 随机端口 + 临时 PACK_STORE_DIR）
07 health                GET /api/health = 200
08 readiness             GET /api/ready = 200 且 ready=true
09 read context          GET /api/v2/contexts/{id}/replay 取回 context 与 evidence
10 read exception        GET /api/v2/contexts/{id}/exceptions 含目标 exception
11 read evidence         GET .../exceptions/{id}/bundle 有证据
12 read audit event      对 restored 副本直读 security_audit_events
```

全通过输出：

```text
RECOVERY_DRILL_VERIFIED
```

任一步失败 → `FAILED` 并列出失败步骤，退出码非 0。

## 本机实测结果

```text
PASS 01.seed / 02.backup / 03.checksum / 04.working_copy_lost / 05.restore
PASS 06.app_started_on_restored_db / 07.health / 08.readiness
PASS 09.context / 10.exception / 11.evidence / 12.audit_event
verdict = RECOVERY_DRILL_VERIFIED
```

（一次真实运行的输出见 commit message；数值随种子数据变化，判定条件不变。）

## 真实事故时的操作顺序

```text
1. 停止写入：docker stop（SIGTERM，应用会等完在途请求再关闭 SQLite）
2. 保住现场：把现有 DB 目录整体改名/拷贝出来，不要就地覆盖
3. 选备份：ls backups/ 选最近的 <timestamp>，核对 manifest.json 的 sha256
4. 恢复：npm run db:restore -- --from <backupDir> --to <newDbPath>（新路径，避免误覆盖）
5. 校验：npm run db:verify-backup（或直接对 restored DB 跑 integrity_check）
6. 切换：把 PACK_STORE_DB 指向 restored DB 后启动，检查 /api/health 与 /api/ready
7. 核对：抽查 Context / Exception / Evidence / Audit 数量与关键 ID
8. 复盘：记录 RPO 实际损失（最后一个成功备份时间差）
```

## RTO / RPO（诚实口径）

```text
本机实测恢复耗时：秒级（单机 SQLite，几百 KB ~ 数 MB）
RPO：等于「最近一次成功备份」的时间点，没有 PITR
RTO：取决于备份体积与介质；跨机/对象存储恢复未验证
```

## Truth boundary

```text
RECOVERY_DRILL_LOCALLY_VERIFIED=true
PRODUCTION_DISASTER_RECOVERY_VERIFIED=false
PRODUCTION_BACKUP_VERIFIED=false
```

本地演练证明的是：备份是一致快照、恢复流程可用、恢复后服务能起来并且能读回
Context / Exception / Evidence / Audit。它**不**证明：

```text
真实生产数据规模下的恢复时长
异地/对象存储备份的可用性
多实例并发写入时的一致性
客户环境或合规意义上的灾备能力
```

## 复现

```bash
npm run ops:recovery-drill
npm run db:verify-backup
```
