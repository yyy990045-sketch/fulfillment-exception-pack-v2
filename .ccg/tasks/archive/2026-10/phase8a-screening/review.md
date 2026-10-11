限定前端三项P1。复用柏林输入/8114、Three.js、productSteps与OperationPlan；不修改后端、OSM或历史业务数据。

- 候选失败混入计划失败：优先result非空原因，其次initialCheck非空原因，最后标明来源的search.failureEvidence。单测包含空result、去重和空reasons分支；实际T12两视口可读且仍禁止执行/导出。
- 非模态候选面板Escape夺取编辑窗口焦点：编辑开启时关闭候选，Escape忽略顶层模态窗口；两视口浏览器核验内部滚动、关闭与焦点返回。
- 装车播放结束进入05误显示卸货完成：进入执行页面时仅切换已有卸货播放视图，保留真实步骤，核验当前/下一步、暂停、换车和完成。

独立只读复审确认上述Warning已处理。证据与检查见 artifacts/phase8a-screening/README.md。
