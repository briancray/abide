# The docs app, built and served by the abide in this workspace. Build context: the repo root.
FROM oven/bun:1.4.4
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
WORKDIR /app/packages/dogfood
RUN bun run build
ENV NODE_ENV=production
CMD ["bun", "../abide/bin/abide.ts", "start"]
