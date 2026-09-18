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
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
