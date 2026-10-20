import { spawn } from "node:child_process";
import { AxiError } from "./errors.js";

function prepareFailed(reason: string): AxiError {
  return new AxiError(
    `Prepare command ${reason}; nothing was moved`,
    "PREPARE_FAILED",
    ["Fix the prepare command, then re-run the same mv"],
  );
}

/**
 * Run `command` through the shell while the caller holds the backlog locks.
 * Its stdout and stderr go to our stderr so stdout stays clean TOON/JSON.
 */
export function runPrepareCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["ignore", 2, 2] });
    child.on("error", (error) =>
      reject(prepareFailed(`could not start: ${error.message}`)),
    );
    child.on("exit", (code, signal) => {
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
