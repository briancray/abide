# syntax=docker/dockerfile:1

# Deploy with `abide compile`: one self-contained server binary.
# `abide build` emits dist/_app for `abide start`; `compile` instead embeds the
# gzip-compressed client assets into a standalone executable — no Bun runtime and
# no dist/ needed on the host. Build context is this app dir (the scaffolded form,
# where @abide/abide resolves from npm).
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
RUN bunx abide compile --out=/app/server

# The binary bundles Bun + assets; the runtime image only needs glibc.
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/server ./server
ENV PORT=3000
EXPOSE 3000
CMD ["./server"]
