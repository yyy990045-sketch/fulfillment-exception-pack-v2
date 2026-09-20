# Apache Superset 官方发布镜像（apache/superset:6.1.0）不自带 psycopg2，
# 官方文档也因此在 docker compose + Postgres 场景建议改用 -dev tag。
# 这里保持固定发布版本，只补一个 Postgres 驱动，避免在 pilot 环境里运行 dev 构建。
FROM apache/superset:6.1.0

USER root
# 镜像的 venv 不带 pip，官方镜像内置 uv，用它把驱动装进运行时 venv
RUN uv pip install --python /app/.venv/bin/python --no-cache "psycopg2-binary>=2.9,<3" \
 && /app/.venv/bin/python -c "import psycopg2; print('psycopg2', psycopg2.__version__)"
