# Phase 2G 验收

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 旧四店工作台 | 通过 | `07-legacy-fleet.png`、`08-legacy-single.png`，浏览器无错误 |
| 旧九店多车 | 通过 | `07-legacy-fleet.png`，8114 旧 `revise-fleet` 返回可执行 |
| 新场景导入与字段校验 | 通过 | `02-import-validated.png`，后端 `VALID` |
| 新场景真实规划 | 通过 | `03-planning-result.png`，C 策略返回 `FEASIBLE` |
| 三维货位与路线同步 | 通过 | `04-packing-result.png`，20 件货物、2 辆车、实际车厢尺寸 |
| 方案确认 | 通过 | `05-packing-confirmed.png`，显示已确认身份 |
| A/B/C 对照 | 通过 | `06-effects-evidence.png`、`ALGORITHM-EVIDENCE.md` |
| 计划导出 | 通过 | `confirmed-plan.json`，身份与当前界面一致 |
| 非法输入 422 | 通过 | `tools/city-delivery-decision/examples-2f/input-*.json`、`verify_v3.py` |
| `SEARCH_EXHAUSTED` | 通过 | `tools/city-delivery-decision/examples-2f/layout-failure.json`、holdout A |
| 保留验证场景 | 通过 | `holdout/comparison.json` |
| 服务断开保留旧计划 | 已有保护逻辑 | `state.tsx` 的服务状态和错误提示分支；未在本轮主动断开服务 |

## 尚未完成

没有把 8112/8113 作为并行正式服务继续维护；8114 是唯一前端接入版本。没有生产级持久化、异步任务、企业真实数据接入、轴荷重心、冷链和规模化性能证明。
