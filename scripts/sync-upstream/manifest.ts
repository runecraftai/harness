/**
 * Manifest + per-dest provenance loading/validation (F10 D3/D7, SYNC-02/SYNC-05).
 *
 * vendor.manifest.json at the repo root is the source of pins (ref + npmVersion);
 * each dest carries vendor.json with the materialized resolvedSha. The sync
 * engine treats BOTH as inputs (base = resolvedSha tarball) and writes both on a
 * clean merge only.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson, writeJson } from "./util.ts";

export interface UpstreamEntry {
	repo: string;
	ref: string;
	npmName: string;
	npmVersion: string;
	subpath: string | null;
	dest: string;
}

export interface Manifest {
	upstreams: Record<string, UpstreamEntry>;
}

export interface VendorJson {
	upstreamRepo: string;
	ref: string;
	resolvedSha: string;
	npmName: string;
	npmVersion: string;
	subpath: string | null;
	vendoredAt: string;
	syncedAt?: string;
}

export const SHA_RE = /^[0-9a-f]{40}$/;

/** taskflow group: all 9 entries of heggria/taskflow (F16 — A1 delta). */
export const GROUPS: Record<string, { title: string; members: string[] }> = {
	taskflow: {
		title: "taskflow (heggria/taskflow — core/pi/dsl + MCP layer, F16)",
		members: [
			"taskflow-core",
			"taskflow-pi",
			"taskflow-dsl",
			"taskflow-mcp-core",
			"taskflow-hosts",
			"taskflow-codex",
			"taskflow-claude",
			"taskflow-opencode",
			"taskflow-grok",
		],
	},
};

export function manifestPath(root: string): string {
	return join(root, "vendor.manifest.json");
}

export function loadManifest(root: string): Manifest {
	const file = manifestPath(root);
	if (!existsSync(file)) {
		throw new Error(
			`vendor.manifest.json not found at ${file} — run the vendoring flow (F1) first.`,
		);
	}
	const manifest = readJson<Manifest>(file);
	if (!manifest || typeof manifest !== "object" || !manifest.upstreams) {
		throw new Error(`vendor.manifest.json at ${file} is invalid JSON or missing "upstreams".`);
	}
	return manifest;
}

export function loadVendorJson(root: string, dest: string): VendorJson {
	const file = join(root, dest, "vendor.json");
	const v = readJson<VendorJson>(file);
	if (!v) {
		throw new Error(
			`vendor.json missing or unparseable at ${file} — re-vendor with \`bun run vendor <name> --force\` before syncing.`,
		);
	}
	return v;
}

/** Structural validation of a manifest (used by --check; returns problems). */
export function validateManifest(manifest: Manifest): string[] {
	const problems: string[] = [];
	const names = Object.keys(manifest.upstreams);
	if (names.length === 0) problems.push("manifest has no upstreams");
	for (const [name, entry] of Object.entries(manifest.upstreams)) {
		if (!entry || typeof entry !== "object") {
			problems.push(`entry "${name}" is not an object`);
			continue;
		}
		if (!entry.repo || typeof entry.repo !== "string") problems.push(`${name}: repo missing`);
		if (!entry.ref || typeof entry.ref !== "string") problems.push(`${name}: ref missing`);
		if (!entry.npmName || typeof entry.npmName !== "string")
			problems.push(`${name}: npmName missing`);
		if (!entry.npmVersion || typeof entry.npmVersion !== "string")
			problems.push(`${name}: npmVersion missing`);
		if (!entry.dest || typeof entry.dest !== "string") problems.push(`${name}: dest missing`);
		if (entry.subpath !== null && typeof entry.subpath !== "string")
			problems.push(`${name}: subpath must be string|null`);
	}
	return problems;
}

/** Validate one dest's vendor.json against the manifest entry. */
export function validateVendorJson(v: VendorJson, entry: UpstreamEntry, dest: string): string[] {
	const problems: string[] = [];
	if (!v.resolvedSha || typeof v.resolvedSha !== "string")
		problems.push(`${dest}: resolvedSha missing`);
	else if (!SHA_RE.test(v.resolvedSha))
		problems.push(`${dest}: resolvedSha "${v.resolvedSha}" is not a 40-hex SHA`);
	if (v.ref !== entry.ref)
		problems.push(`${dest}: vendor.json ref "${v.ref}" != manifest ref "${entry.ref}"`);
	if (v.npmName !== entry.npmName)
		problems.push(`${dest}: vendor.json npmName "${v.npmName}" != manifest "${entry.npmName}"`);
	return problems;
}

/** Group members as {name, entry} pairs; throws when a member is unknown. */
export function groupMembers(
	manifest: Manifest,
	group: string,
): { name: string; entry: UpstreamEntry }[] {
	const def = GROUPS[group];
	if (!def) {
		throw new Error(`unknown group "${group}". Known groups: ${Object.keys(GROUPS).join(", ")}`);
	}
	const out: { name: string; entry: UpstreamEntry }[] = [];
	for (const member of def.members) {
		const entry = manifest.upstreams[member];
		if (!entry) {
			throw new Error(
				`group "${group}" member "${member}" is not in vendor.manifest.json — vendor it first (F1).`,
			);
		}
		out.push({ name: member, entry });
	}
	return out;
}

/** All upstream names in the manifest (for --list / arg validation). */
export function upstreamNames(manifest: Manifest): string[] {
	return Object.keys(manifest.upstreams).sort();
}

export function destExists(root: string, entry: UpstreamEntry): boolean {
	const dest = join(root, entry.dest);
	return existsSync(dest) && readdirSync(dest).length > 0;
}

export { existsSync, join, resolve, writeJson };
