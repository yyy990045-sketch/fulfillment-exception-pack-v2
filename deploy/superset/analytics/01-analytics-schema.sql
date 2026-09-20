-- 单独的分析投影库：不迁移核心业务库，只放 Superset 需要的聚合事实表。
-- 首次初始化 postgres 数据卷时执行一次；后续由 scripts/export-superset-projection.ts
-- 生成的 SQL 覆盖写入。
CREATE DATABASE analytics;
\connect analytics

CREATE SCHEMA IF NOT EXISTS analytics;

-- 异常类型分布
CREATE TABLE IF NOT EXISTS analytics.fact_exception_type (
  tenant_id        text        NOT NULL,
  exception_code   text        NOT NULL,
  exception_label  text        NOT NULL,
  exception_count  integer     NOT NULL,
  exported_at      timestamptz NOT NULL DEFAULT now()
);

-- 治理推进（阶段顺序固定，0 值阶段也保留）
CREATE TABLE IF NOT EXISTS analytics.fact_resolution_stage (
  tenant_id        text        NOT NULL,
  stage            text        NOT NULL,
  stage_label      text        NOT NULL,
  stage_order      integer     NOT NULL,
  exception_count  integer     NOT NULL,
  exported_at      timestamptz NOT NULL DEFAULT now()
);

-- 规则触发率
CREATE TABLE IF NOT EXISTS analytics.fact_rule_performance (
  tenant_id        text        NOT NULL,
  rule_code        text        NOT NULL,
  rule_label       text        NOT NULL,
  matched          integer     NOT NULL,
  not_matched      integer     NOT NULL,
  evaluations      integer     NOT NULL,
  trigger_rate     numeric(6,4),
  exported_at      timestamptz NOT NULL DEFAULT now()
);

-- 来源系统分布
CREATE TABLE IF NOT EXISTS analytics.fact_source_system (
  tenant_id                text        NOT NULL,
  source_system_id         text        NOT NULL,
  source_system_name       text        NOT NULL,
  system_type              text        NOT NULL,
  involved_exception_count integer     NOT NULL,
  exported_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fact_exception_type_tenant_idx   ON analytics.fact_exception_type (tenant_id);
CREATE INDEX IF NOT EXISTS fact_resolution_stage_tenant_idx ON analytics.fact_resolution_stage (tenant_id);
CREATE INDEX IF NOT EXISTS fact_rule_performance_tenant_idx ON analytics.fact_rule_performance (tenant_id);
CREATE INDEX IF NOT EXISTS fact_source_system_tenant_idx    ON analytics.fact_source_system (tenant_id);
