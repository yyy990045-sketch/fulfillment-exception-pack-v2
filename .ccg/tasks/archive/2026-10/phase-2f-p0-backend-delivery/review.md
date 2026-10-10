# Review

## Critical

无。

## Warning

- 新服务当前运行在本机 `8114`，前端现有代理仍指向旧的 `8112`；前端接入新场景时必须显式切换服务地址或代理，不能假设旧入口自动支持 3.0.0 场景。
- A/B/C 证据只覆盖三个合成实例、每种方法三次运行。它能证明当前样例中的可执行性差异，不能证明全局最优或企业降本。
- `SEARCH_EXHAUSTED` 是有限候选和预算范围内未找到解，不是数学意义上的全局不可行。

## Verification

- `tools/city-delivery-decision/.venv/bin/python tools/city-delivery-decision/verify_v3.py` 已在 `8114` 执行成功。
- 新场景导入、成功规划、窄车空间失败、晚发车时间窗失败、缺字段/非法尺寸/重复编号均有真实 HTTP 样例。
- 旧 `revise-order` 和 `revise-fleet` 入口仍返回可执行结果。
- v1/v2 静态 JSON 未被本轮修改。
