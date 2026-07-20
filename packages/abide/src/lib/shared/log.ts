// log — isomorphic structured logging (CO2.1/CO2.2). Callable `log(...)` plus level methods
// `.info` / `.warn` / `.error` / `.trace`, and `.channel(name)` for a namespaced logger.
//
// Server: structured lines to stdout (info/trace/log) and stderr (warn/error) — JSON when
// `ABIDE_LOG_FORMAT=json`, else a compact tab-separated line (level, time, [channel], traceparent,
// message). Client: plain `console`. Named channels are gated by the `DEBUG` env var following the
// debug-npm pattern (`DEBUG=cache,rpc` or `DEBUG=*`), so framework internals stay quiet until asked
// for. The active request's `traceparent` (CO2.3) is auto-correlated into each server line.
//
// `trace` is referenced only inside the emit path (never at module load) so this module never
// participates in an import cycle with the request scope.

import { trace } from "./trace.ts";

type LogLevel = "log" | "info" | "warn" | "error" | "trace";

export interface ChannelLogger {
  (...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  trace(...args: unknown[]): void;
}

export interface Logger extends ChannelLogger {
  channel(name: string): ChannelLogger;
}

const isBrowser = typeof globalThis !== "undefined" && typeof (globalThis as { window?: unknown }).window !== "undefined";

// Read a framework env var at call time so tests (and the running process) see live changes.
function readEnv(name: string): string | undefined {
  const bunEnv = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env;
  if (bunEnv !== undefined) return bunEnv[name];
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// The debug-npm gate: a channel emits when DEBUG names it (exact), when DEBUG is `*`, or when a
// listed pattern ends in `*` and prefixes the channel name (e.g. `abide:*` lights `abide:cache`).
function channelEnabled(channel: string): boolean {
  const debug = readEnv("DEBUG");
  if (debug === undefined || debug.length === 0) return false;
  const patterns = debug.split(",");
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i]!.trim();
    if (pattern.length === 0) continue;
    if (pattern === "*") return true;
    if (pattern === channel) return true;
    if (pattern.endsWith("*") && channel.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function emit(level: LogLevel, channel: string | undefined, args: unknown[]): void {
  if (channel !== undefined && !channelEnabled(channel)) return;

  if (isBrowser) {
    const console = (globalThis as unknown as { console?: Record<string, ((...a: unknown[]) => void) | undefined> }).console;
    if (console === undefined) return;
    const method = console[level] ?? console.log;
    if (method === undefined) return;
    if (channel !== undefined) method(`[${channel}]`, ...args);
    else method(...args);
    return;
  }

  const time = new Date().toISOString();
  const traceparent = trace();
  const message = args.map(formatArg).join(" ");

  let line: string;
  if (readEnv("ABIDE_LOG_FORMAT") === "json") {
    const record: { level: string; time: string; channel?: string; traceparent?: string; message: string } = {
      level,
      time,
      message,
    };
    if (channel !== undefined) record.channel = channel;
    if (traceparent !== undefined) record.traceparent = traceparent;
    line = JSON.stringify(record);
  } else {
    const parts = [level, time];
    if (channel !== undefined) parts.push(`[${channel}]`);
    if (traceparent !== undefined) parts.push(traceparent);
    parts.push(message);
    line = parts.join("\t");
  }

  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}

function makeChannelLogger(channel: string | undefined): ChannelLogger {
  const logger = ((...args: unknown[]): void => emit("log", channel, args)) as ChannelLogger;
  logger.info = (...args: unknown[]): void => emit("info", channel, args);
  logger.warn = (...args: unknown[]): void => emit("warn", channel, args);
  logger.error = (...args: unknown[]): void => emit("error", channel, args);
  logger.trace = (...args: unknown[]): void => emit("trace", channel, args);
  return logger;
}

export const log: Logger = Object.assign(makeChannelLogger(undefined), {
  channel(name: string): ChannelLogger {
    return makeChannelLogger(name);
  },
});
