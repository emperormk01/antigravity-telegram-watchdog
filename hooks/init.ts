import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export default async function init(ctx: {
  logger?: { info: (obj: unknown, msg: string) => void };
}): Promise<void> {
  // AGY Telegram supervisor (guarded: script may be absent).
  // Mirrors opencode-telegram-startup/hooks/init.ts: launch detached and
  // unref so the hook returns while the supervisor owns the gateway.
  if (existsSync("/workspace/bin/agy-telegram-supervise")) {
    const child = spawn("/workspace/bin/agy-telegram-supervise", [], {
      cwd: "/workspace/agy-trial",
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    ctx.logger?.info(
      { pid: child.pid, service: "agy-telegram" },
      "AGY Telegram supervisor launched",
    );
  } else {
    ctx.logger?.info(
      { service: "agy-telegram" },
      "agy-telegram-supervise not found; skipping launch",
    );
  }
}
