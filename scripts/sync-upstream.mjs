// Keep this fork's `main` identical to upstream and its fix branches built on top of it.
//
// `main` never carries fork commits, so `git merge --ff-only upstream/main` can never stop at a conflict. Work
// lives on branches; this script moves them forward with a rebase instead of a merge, so they keep replaying
// cleanly however far upstream moves. Nothing is forced: a branch that conflicts is left exactly as it was,
// with its own commits intact, and named for a person to resolve.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args, { allowFailure = false } = {}) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (!allowFailure) throw new Error(`git ${args.join(" ")} failed: ${error.stderr?.toString?.() ?? error.message}`);
    return null;
  }
};
const say = (line) => console.log(line);

function currentBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function dirty() {
  return git(["status", "--porcelain"]).length > 0;
}

/** Local branches holding commits upstream does not have — the ones a rebase would move. */
function fixBranches() {
  const names = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n").filter(Boolean);
  return names.filter((name) => name !== "main" && git(["rev-list", "--count", `upstream/main..${name}`]) !== "0");
}

function main() {
  if (dirty()) {
    say("Working tree has changes. Commit or stash them first; this script never stashes for you.");
    process.exit(1);
  }
  const started = currentBranch();

  say("Fetching upstream …");
  git(["fetch", "upstream", "--prune"]);

  say("Fast-forwarding main …");
  git(["checkout", "main"]);
  const before = git(["rev-parse", "--short", "HEAD"]);
  git(["merge", "--ff-only", "upstream/main"]);
  const after = git(["rev-parse", "--short", "HEAD"]);
  say(before === after ? `  main already at ${after}` : `  main ${before} → ${after}`);

  say("Pushing main to origin …");
  git(["push", "origin", "main"]);

  const branches = fixBranches();
  const failed = [];
  for (const branch of branches) {
    say(`Rebasing ${branch} onto upstream/main …`);
    git(["checkout", branch]);
    if (git(["rebase", "upstream/main"], { allowFailure: true }) === null) {
      git(["rebase", "--abort"], { allowFailure: true });
      failed.push(branch);
      say(`  conflicts; ${branch} is back where it was. Resolve with: git checkout ${branch} && git rebase upstream/main`);
      continue;
    }
    say(`  rebased; push it with: git push --force-with-lease origin ${branch}`);
  }

  git(["checkout", started]);
  if (failed.length) {
    say(`\nNeeds a person: ${failed.join(", ")}`);
    process.exit(1);
  }
  say("\nDone. Branch rebases are local only; each push stays a deliberate --force-with-lease.");
}

main();
