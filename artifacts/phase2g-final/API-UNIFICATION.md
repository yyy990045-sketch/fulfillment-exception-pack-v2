# Phase 2G 服务统一

## 正式版本

统一使用 `tools/city-delivery-decision/server.py` 的 2F/3.0.0 标准场景服务，正式本机地址为 `http://127.0.0.1:8114`。

前端 Vite 代理已默认指向 8114，也可以通过 `CITY_DELIVERY_BACKEND_URL` 覆盖。

入口：

- `GET /health`
- `GET /contract`
- `POST /api/city-delivery/validate-scene`
- `POST /api/city-delivery/plan-scene`
- `POST /api/city-delivery/revise-order`
- `POST /api/city-delivery/revise-fleet`

## 两套旧说明的处理

`HANDOFF-V3.md` 记录的是早期 8112 标准入口，`HANDOFF-2F.md` 记录的是补齐校验和三种策略后的 8114 入口。正式接入以后以 8114 和 `CONTRACT-2F.md` 为准，旧四店/九店入口仍保留在同一服务内。

本次检查时 8112、8113 没有保持运行；没有把它们当成正式依赖，也没有全局抢占旧端口。8114 已实际返回 3.0.0 契约，校验、规划、旧单车调整和旧多车调整均可调用。

## 结果身份

所有新请求返回 `scenarioId`、`planId`、`revisionId`、`constraintVersion`、`solverStatus`。前端只有在用户点击确认后才把 `FEASIBLE` 结果作为当前计划，`SEARCH_EXHAUSTED`、`BUSY`、`TIMEOUT` 和服务错误不会清空原计划。

## 服务边界

服务无数据库、无异步任务查询、无生产级并发承诺。当前限制和未支持约束以 `/contract` 与 [CONTRACT-2F.md](../../tools/city-delivery-decision/CONTRACT-2F.md) 为准。
