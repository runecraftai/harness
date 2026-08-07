// conflicts.ts — upstream collision scan shared by install/doctor/status/sync (CLI-09, F12 check 4).
//
// Upstream packages that collide with the runecraft forks. The harness only
// warns and suggests removal — it never removes anything (full handling in F18).
import { npmIdentity } from "./pi.ts";
import { UPSTREAM_PACKAGES } from "./plan.ts";

export interface ConflictInfo {
  package: string;
  suggestion: string;
}

function matchesUpstream(packageName: string): string | null {
  for (const upstream of UPSTREAM_PACKAGES) {
    if (packageName === upstream || packageName.endsWith(`/${upstream}`)) return upstream;
  }
  return null;
}

/** Scan installed packages (pi list + settings fallback) for upstream collisions (CLI-09). */
export function scanConflicts(installed: string[]): ConflictInfo[] {
  const seen = new Set<string>();
  const conflicts: ConflictInfo[] = [];
  for (const entry of installed) {
    const name = npmIdentity(entry).replace(/^npm:/, "");
    const upstream = matchesUpstream(name);
    if (upstream && !seen.has(name)) {
      seen.add(name);
      conflicts.push({
        package: entry,
        suggestion: `pi remove ${npmIdentity(entry)}`,
      });
    }
  }
  return conflicts;
}
