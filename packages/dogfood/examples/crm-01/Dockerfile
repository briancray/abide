FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun x abide compile --out /app/server

FROM gcr.io/distroless/cc-debian12
COPY --from=build /app/server /server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["/server", "start"]
