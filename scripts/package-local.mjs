// A build for this machine, carrying the fork's fixes. `package:mac` stamps the version it reads from
// package.json, which must keep tracking upstream or every `git merge --ff-only upstream/main` would stop at
// a package.json conflict. So the version is raised only for this build: the next patch number with a
// `-local` tag, which sorts above the release it was made from and names the artifact as this machine's.
//
// The steps are package:mac's own, written out rather than appended to it: pnpm would read a trailing
// `--config.…` as one of its own options.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!match) {
  console.error(`[package:local] cannot read a version from package.json ("${version}")`);
  process.exit(1);
}
const local = `${match[1]}.${match[2]}.${Number(match[3]) + 1}-local.1`;
console.log(`[package:local] building ${local} (package.json stays at ${version})`);

const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
for (const step of ["package:prepare", "build:speech", "build:cua"]) run("pnpm", [step]);
run("pnpm", ["exec", "electron-builder", "--mac", "--publish", "never", `--config.extraMetadata.version=${local}`]);
