import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { parseOptionalNonNegativeIntegerFlag } from "./args.js";
import { LOCK_STALE_MS } from "./backends/lock.js";
import { AxiError } from "./errors.js";

export const DEFAULT_PREPARE_TIMEOUT_MS = 10_000;
/** Stays under the lock stale threshold so a healthy prepare never makes the held locks look abandoned. */
export const MAX_PREPARE_TIMEOUT_MS = LOCK_STALE_MS - 5_000;

export function parsePrepareTimeout(raw: string | undefined): number {
  const flag = "--prepare-timeout-ms";
  const ms = parseOptionalNonNegativeIntegerFlag(flag, raw);
  if (ms === undefined) return DEFAULT_PREPARE_TIMEOUT_MS;
  if (ms < 1) {
    throw new AxiError(`${flag} must be at least 1`, "VALIDATION_ERROR");
  }
  if (ms > MAX_PREPARE_TIMEOUT_MS) {
    throw new AxiError(
      `${flag} must be at most ${MAX_PREPARE_TIMEOUT_MS}`,
      "VALIDATION_ERROR",
    );
  }
  return ms;
}

function prepareFailed(reason: string): AxiError {
  return new AxiError(
    `Prepare command ${reason}; nothing was moved`,
    "PREPARE_FAILED",
    ["Fix the prepare command, then re-run the same mv"],
  );
}

function killTree(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // already exited
  }
}

/**
 * Run `command` through the shell while the caller holds the backlog locks,
 * killing it (and its process group) after `timeoutMs`. Its stdout and stderr
 * go to our stderr so stdout stays clean TOON/JSON.
 */
export function runPrepareCommand(
  command: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", 2, 2],
    });
    const timer = setTimeout(() => {
      killTree(child);
      reject(prepareFailed(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(prepareFailed(`could not start: ${error.message}`));
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          prepareFailed(
            code === null ? `was killed by ${signal}` : `failed (exit ${code})`,
          ),
        );
    });
  });
}
