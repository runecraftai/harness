// memory/project.ts — identidade do projeto (port de lib/project.ts do
// runes): slug derivado do remote git normalizado
// (regex SSH/HTTPS, strip .git), fallback para o path absoluto quando não há
// remote; worktrees do mesmo repo compartilham o mesmo git root → mesma
// memória (D1).
//
// Env: RUNECRAFT_MEMORY_PROJECT_SLUG (rename do RUNES_PROJECT_SLUG — override
// determinístico para testes/evals).
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProjectIdentity {
	slug: string;
	rootPath: string;
	remoteUrl: string | null;
}

const SSH_REMOTE_RE = /^git@[^:]+:(.+?)(?:\.git)?$/;
const HTTPS_REMOTE_RE = /^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/;

/** Normaliza a URL do remote: SSH/HTTPS → caminho após o host; strip .git. */
export function normalizeRemoteUrl(url: string): string {
	const trimmed = url.trim();
	const ssh = trimmed.match(SSH_REMOTE_RE);
	if (ssh) return ssh[1] ?? "";
	const https = trimmed.match(HTTPS_REMOTE_RE);
	if (https) return https[1] ?? "";
	return trimmed.replace(/\.git$/, "");
}

/** Slug = último segmento do remote normalizado (same semantics do source). */
export function deriveSlugFromRemote(remoteUrl: string): string {
	const normalized = normalizeRemoteUrl(remoteUrl);
	const segments = normalized.split("/").filter(Boolean);
	if (segments.length === 0) return normalized;
	return segments[segments.length - 1] ?? normalized;
}

/** Sobe a árvore de diretórios até achar `.git` (fallback: null). */
export function findGitRoot(start: string): string | null {
	let current = isAbsolute(start) ? start : resolve(start);
	const { root } = { root: "/" };
	while (true) {
		if (existsSync(joinPath(current, ".git"))) return current;
		const parent = resolve(current, "..");
		if (parent === current || parent === root) return null;
		current = parent;
	}
}

function joinPath(dir: string, child: string): string {
	return dir.endsWith(sep) ? `${dir}${child}` : `${dir}${sep}${child}`;
}

/** remote.origin.url do git root (timeout 1s — port; sem remote → null). */
export async function readRemoteUrl(gitRoot: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", gitRoot, "config", "--get", "remote.origin.url"],
			{ timeout: 1000, windowsHide: true },
		);
		const url = stdout.trim();
		return url.length > 0 ? url : null;
	} catch {
		return null;
	}
}

/** Leitura SÍNCRONA do remote.origin.url (timeout 1s — sem remote → null).
 *  Variante usada pela extensão Pi (registro de tools no session_start é
 *  síncrono — padrão glla; a chamada síncrona evita race no request do
 *  primeiro turno). Mesma semântica do readRemoteUrl async. */
export function readRemoteUrlSync(gitRoot: string): string | null {
	try {
		const stdout = execFileSync(
			"git",
			["-C", gitRoot, "config", "--get", "remote.origin.url"],
			{ timeout: 1000, windowsHide: true, encoding: "utf-8" },
		);
		const url = stdout.trim();
		return url.length > 0 ? url : null;
	} catch {
		return null;
	}
}

/** Variante SÍNCRONA do resolveProjectSlug (extensão Pi — session_start). */
export function resolveProjectSlugSync(
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): ProjectIdentity {
	const envOverride = env.RUNECRAFT_MEMORY_PROJECT_SLUG;
	const absoluteCwd = isAbsolute(cwd) ? cwd : resolve(cwd);

	const gitRoot = findGitRoot(absoluteCwd);
	if (gitRoot) {
		const remoteUrl = readRemoteUrlSync(gitRoot);
		if (remoteUrl) {
			return {
				slug: envOverride ?? deriveSlugFromRemote(remoteUrl),
				rootPath: gitRoot,
				remoteUrl,
			};
		}
	}

	return {
		slug: envOverride ?? absoluteCwd,
		rootPath: gitRoot ?? absoluteCwd,
		remoteUrl: null,
	};
}

/**
 * Resolve a identidade do projeto para um cwd: git root + remote slug quando
 * disponível; sem remote → path absoluto do cwd (edge case da spec); sem git
 * root → path absoluto do cwd. Env override vence (determinismo — evals).
 */
export async function resolveProjectSlug(
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectIdentity> {
	return resolveProjectSlugSync(cwd, env);
}
