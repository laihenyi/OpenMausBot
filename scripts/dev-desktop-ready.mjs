// `pnpm dev:desktop` starts the desktop shell over the Vite dev server. A previous run that is still open
// makes the new one lose the single-instance lock and exit at once ("OpenMausBot is already running —
// focusing that window"), which reads as nothing having happened. Stop this checkout's own Electron first,
// and only this checkout's: another project's Electron or the installed app is left alone.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WAIT_MS = 4_000;
const POLL_MS = 200;

/** The main process only: a helper's command also names the binary, but ending it first would strip the app. */
const MAIN_BINARY = "/Electron.app/Contents/MacOS/Electron";

function thisCheckoutsElectrons() {
  if (process.platform === "win32") return [];
  let listed = "";
  try {
    listed = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return [];
  }
  return listed.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) return [];
    const pid = Number(match[1]);
    const command = match[2];
    // This checkout's copy of the binary, not another project's, the installed app, or this script.
    if (pid === process.pid || !command.includes(root) || !command.includes("/.pnpm/electron@")) return [];
    if (!command.trim().endsWith(MAIN_BINARY) && !command.includes(`${MAIN_BINARY} `)) return [];
    return [{ pid }];
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitGone(ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const alive = thisCheckoutsElectrons();
    if (alive.length === 0) return [];
    if (Date.now() >= deadline) return alive;
    await sleep(POLL_MS);
  }
}

async function main() {
  const stale = thisCheckoutsElectrons();
  if (stale.length === 0) return;
  for (const { pid } of stale) {
    console.log(`[dev:desktop] stopping the previous Electron (pid ${pid})`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
    }
  }
  let alive = await waitGone(WAIT_MS);
  if (alive.length === 0) return;
  // A dev shell that ignored SIGTERM this long will not take it, and the new window cannot open until it
  // is gone; nothing in it is worth more than the run the person just asked for.
  for (const { pid } of alive) {
    console.log(`[dev:desktop] pid ${pid} ignored SIGTERM for ${WAIT_MS / 1000}s; ending it`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
    }
  }
  alive = await waitGone(2_000);
  if (alive.length > 0) {
    console.error("[dev:desktop] a previous Electron is still running; quit it and run this again");
    process.exit(1);
  }
}

await main();
