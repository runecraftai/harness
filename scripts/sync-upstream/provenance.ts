/**
 * Conditional provenance updates (F10 D7, SYNC-02).
 *
 * On a CLEAN merge: vendor.json (dest) and vendor.manifest.json (ref) are
 * updated with the new ref/resolvedSha/npmVersion + syncedAt. On conflict or
 * error: NOTHING is written (fail-closed) — the caller never reaches here.
 * `vendoredAt` is preserved (history); `syncedAt` records the cycle.
 */

import { join } from "node:path";
import type { Manifest, UpstreamEntry, VendorJson } from "./manifest.ts";
import { loadVendorJson } from "./manifest.ts";
import { readJson, writeJson } from "./util.ts";

export interface SyncProvenance {
	ref: string;
	resolvedSha: string;
	npmVersion: string;
	syncedAt: string;
}

/** New vendor.json content for the dest (preserves vendoredAt history). */
export function nextVendorJson(prev: VendorJson, p: SyncProvenance): VendorJson {
	return {
		...prev,
		ref: p.ref,
		resolvedSha: p.resolvedSha,
		npmVersion: p.npmVersion,
		syncedAt: p.syncedAt,
	};
}

/** Update vendor.json of a dest (write only — caller guards fail-closed). */
export function writeVendorJson(root: string, dest: string, p: SyncProvenance): VendorJson {
	const prev = loadVendorJson(root, dest);
	const next = nextVendorJson(prev, p);
	writeJson(join(root, dest, "vendor.json"), next);
	return next;
}

/** Update the manifest entry for one upstream (ref + npmVersion per D7). */
export function updateManifestEntry(root: string, name: string, p: SyncProvenance): void {
	const file = join(root, "vendor.manifest.json");
	const manifest = readJson<Manifest>(file);
	if (!manifest || !manifest.upstreams?.[name]) {
		throw new Error(`cannot update manifest: entry "${name}" not found in vendor.manifest.json`);
	}
	manifest.upstreams[name] = {
		...manifest.upstreams[name],
		ref: p.ref,
		npmVersion: p.npmVersion,
	};
	writeJson(file, manifest);
}

/** Provenance summary printed by the sync report. */
export function describe(entry: UpstreamEntry, p: SyncProvenance): string {
	return `${entry.npmName} ${entry.ref} -> ${p.ref} (${p.resolvedSha.slice(0, 12)})`;
}
