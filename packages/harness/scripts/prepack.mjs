// Prepack hook for @runecraft/harness (F6).
//
// Problem: in this monorepo, bun workspaces link the bundled forks into
// node_modules/@runecraft/* as symlinks. npm pack follows those symlinks and
// computes tar paths from the *real* location (e.g. ../taskflow/pi/
// node_modules/@runecraft/taskflow-core/...), producing duplicated entries with
// ".." paths and `tar TAR_ENTRY_ERROR` warnings in the published tarball.
//
// Fix: materialize real copies of the 6 bundled forks (excluding node_modules)
// before npm packs. npm-packlist still applies each fork's own `files` list when
// bundling, so only the fork's published files end up in the tarball.
//
// Note: npm does NOT install transitive deps of bundled deps, so the forks'
// non-peer runtime deps (jiti/yaml from subagents, typescript from taskflow-dsl)
// are declared as regular `dependencies` of this package (fetched from the
// registry at install time). typebox is NOT bundled: it arrives via Pi as an
// optional peer dependency (see peerDependencies/peerDependenciesMeta) and is
// consumed from the host's install at runtime.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Source of truth: the dependencies listed in bundledDependencies in package.json.
const BOUNDED = [
  "@runecraft/subagents",
  "@runecraft/taskflow-core",
  "@runecraft/taskflow",
  "@runecraft/taskflow-dsl",
  "@runecraft/goal-loop-audit",
  "@runecraft/pr-review",
];

for (const name of BOUNDED) {
  const link = join(pkgRoot, "node_modules", name);
  if (!existsSync(link)) {
    process.stderr.write(`prepack: missing bundled dep ${name} — run \`bun install\` at the repo root first.\n`);
    process.exit(1);
  }
  const st = lstatSync(link);
  if (st.isSymbolicLink()) {
    // Workspace symlink: materialize a real copy of the fork (excluding its
    // node_modules and .git) so npm pack doesn't follow the symlink and emit
    // duplicated entries with ".." paths.
    const real = resolve(dirname(link), readlinkSync(link));
    rmSync(link, { recursive: true, force: true });
    mkdirSync(dirname(link), { recursive: true });
    const filter = (src) => {
      // Drop the fork's own node_modules and .git (not part of its published files).
      const parts = src.split("/");
      return !parts.includes("node_modules") && !parts.includes(".git");
    };
    cpSync(real, link, { recursive: true, filter });
    const count = readdirSync(link).length;
    process.stderr.write(`prepack: materialized ${name} (${count} top-level entries)\n`);
    continue;
  }
  // Real directory (registry install or a previous materialization): apply the
  // same node_modules/.git cleanup so the packed tarball stays hermetic even
  // when the forks were not installed as workspace symlinks.
  rmSync(join(link, "node_modules"), { recursive: true, force: true });
  rmSync(join(link, ".git"), { recursive: true, force: true });
  process.stderr.write(`prepack: cleaned ${name} (real dir, no node_modules/.git)\n`);
}
