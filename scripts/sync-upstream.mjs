// Keep this fork's `main` identical to upstream and its fix branches built on top of it.
//
// `main` never carries fork commits, so `git merge --ff-only upstream/main` can never stop at a conflict. Work
// lives on branches; this script moves them forward with a rebase instead of a merge, so they keep replaying
// cleanly however far upstream moves. Nothing is forced: a branch that conflicts is left exactly as it was,
// with its own commits intact, and named for a person to resolve.
//
// `--drop-subject <regex>` also removes a branch's commits whose subject matches, for work upstream has since
// taken in — often through someone else's differently-written PR, which `git cherry` cannot see. Matching on the
// subject rather than a hash is what makes it survive a rebase: the hashes change, the subject does not. A commit
// stays when upstream never touched a file it changed, since dropping that one would quietly lose the work.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** The commits on `branch` that upstream does not have, oldest first, with the files each one touches. */
function branchCommits(branch) {
  return git(["log", "--reverse", "--format=%H%x00%s", `upstream/main..${branch}`])
    .split("\n").filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split("\0");
      const files = git(["show", "--name-only", "--format=", hash]).split("\n").filter(Boolean);
      return { hash, subject, files };
    });
}

/**
 * Which of `branch`'s commits a `--drop-subject` pattern selects, split by whether upstream could hold the work.
 *
 * `safe` means upstream changed at least one file the commit changed, since the point the branch left it — the
 * only way it can have taken the work in. `suspect` means upstream never touched any of those files, so the
 * commit's change cannot be there and dropping it would silently lose it.
 */
function planDrop(branch, pattern) {
  const base = git(["merge-base", branch, "upstream/main"]);
  const re = new RegExp(pattern, "i");
  const selected = branchCommits(branch).filter((commit) => re.test(commit.subject));
  const safe = [];
  const suspect = [];
  for (const commit of selected) {
    const reached = commit.files.some((file) => git(["log", "--oneline", `${base}..upstream/main`, "--", file]).length > 0);
    (reached ? safe : suspect).push(commit);
  }
  return { safe, suspect };
}

/**
 * Rebase `branch` onto upstream/main in one interactive pass, dropping exactly the commits whose subject is in
 * `subjects`.
 *
 * The sequence editor reads the todo list git writes and marks those `pick` lines `drop`, so the rule is subject
 * text — never a hash, which every rebase rewrites. The subjects travel in the environment as JSON, so a subject
 * holding quotes or regex characters needs no escaping and cannot match a neighbouring commit. Returns false when
 * the rebase stops, leaving the caller to abort it.
 */
function dropCommits(subjects) {
  if (subjects.length === 0) return git(["rebase", "upstream/main"], { allowFailure: true }) !== null;
  const dir = mkdtempSync(join(tmpdir(), "omb-sync-"));
  const editor = join(dir, "sequence-editor.mjs");
  // The sequence editor git runs: rewrite this rebase's todo list in place.
  writeFileSync(editor, `import { readFileSync, writeFileSync } from "node:fs";
const drop = new Set(JSON.parse(process.env.OMB_DROP_SUBJECTS));
const file = process.argv[2];
// A todo line is "pick <hash> <subject>", and git may separate the two with "# " (rebase.instructionFormat).
const lines = readFileSync(file, "utf8").split("\\n").map((line) => {
  const match = /^pick\\s+(\\S+)\\s+(?:#\\s+)?(.*)$/.exec(line);
  return match && drop.has(match[2]) ? line.replace(/^pick/, "drop") : line;
});
writeFileSync(file, lines.join("\\n"));
`);
  try {
    execFileSync("git", ["rebase", "-i", "upstream/main"], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_SEQUENCE_EDITOR: `"${process.execPath}" "${editor}"`,
        OMB_DROP_SUBJECTS: JSON.stringify(subjects),
      },
    });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Which running processes the commits between two revisions made stale. A dev session loads code once at
 * start: the server and the desktop shell hold the old copy until restarted, while Vite reloads the UI itself.
 */
function staleRuntimes(before, after) {
  const touched = git(["diff", "--name-only", before, after]).split("\n").filter(Boolean);
  const deps = touched.some((path) => path === "package.json" || path === "pnpm-lock.yaml");
  return {
    server: deps || touched.some((path) => /^(server|companion)\//.test(path)),
    electron: deps || touched.some((path) => path.startsWith("electron/")),
  };
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--drop-subject");
  const dropSubject = at === -1 ? "" : args[at + 1] ?? "";
  if (at !== -1 && !dropSubject) {
    say("--drop-subject needs a regular expression to match against commit subjects.");
    process.exit(1);
  }
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

  // A dev session loads code at start, so the restart that follows is decided by what moved, not by habit.
  if (before !== after) {
    const stale = staleRuntimes(before, after);
    const names = [stale.server && "the server", stale.electron && "the desktop shell"].filter(Boolean);
    if (names.length === 0) say("  no runtime file changed — a running dev session is still current (Vite reloads the UI)");
    else say(`  restart ${names.join(" and ")} when convenient: it holds the code from before this pull`);
  }

  say("Pushing main to origin …");
  git(["push", "origin", "main"]);

  const branches = fixBranches();
  const failed = [];
  for (const branch of branches) {
    say(`Rebasing ${branch} onto upstream/main …`);
    git(["checkout", branch]);
    const plan = dropSubject ? planDrop(branch, dropSubject) : { safe: [], suspect: [] };
    for (const commit of plan.suspect) {
      say(`  keeping "${commit.subject}": upstream has not touched ${commit.files.join(", ")} since the branch point,`);
      say("    so that change cannot be in it — drop it by hand if that is wrong");
    }
    for (const commit of plan.safe) say(`  dropping "${commit.subject}": upstream now carries that work`);
    if (!dropCommits(plan.safe.map((commit) => commit.subject))) {
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
