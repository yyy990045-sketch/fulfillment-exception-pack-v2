FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY contracts ./contracts

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3410
ENV PACK_STORE_DIR=/app/data/pack-cases
ENV PACK_STORE_BACKEND=sqlite
ENV PACK_STORE_DB=/app/data/pack-cases.sqlite

RUN mkdir -p /app/data/pack-cases
EXPOSE 3410
# 容器 liveness 只看 /api/health（进程存活）；/api/ready 含外部集成条件，不适合做重启依据
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3410)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
