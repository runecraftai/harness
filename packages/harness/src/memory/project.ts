// memory/project.ts — identidade do projeto (port de lib/project.ts do
// runes): slug derivado do remote git normalizado
// (regex SSH/HTTPS, strip .git), fallback para o path absoluto quando não há
// remote; worktrees linkadas do mesmo repo resolvem para o checkout PRINCIPAL
// (resolveSharedGitRootSync) → mesma memória (D1).
//
// Env: RUNECRAFT_MEMORY_PROJECT_SLUG (rename do RUNES_PROJECT_SLUG — override
// determinístico para testes/evals).
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
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

/** Sobe a árvore de diretórios até achar `.git` (fallback: null). Para uma
 *  linked worktree o `.git` é um ARQUIVO no próprio worktree → o retorno é o
 *  worktree, não o checkout principal (ver resolveSharedGitRootSync). */
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

/** `.git` é arquivo? Linked worktree e submodule usam `gitdir: <path>`. */
function isGitFile(gitPath: string): boolean {
	try {
		return statSync(gitPath).isFile();
	} catch {
		return false;
	}
}

/** Primeiro `worktree <path>` de `git worktree list --porcelain` — o MAIN
 *  worktree é sempre listado primeiro (verificado em worktree real). */
function readMainWorktreeSync(gitRoot: string): string | null {
	try {
		const stdout = execFileSync("git", ["-C", gitRoot, "worktree", "list", "--porcelain"], {
			timeout: 1000,
			windowsHide: true,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const line = stdout.split("\n").find((l) => l.startsWith("worktree "));
		const path = line?.slice("worktree ".length).trim() ?? "";
		return path.length > 0 ? path : null;
	} catch {
		return null;
	}
}

/** `git rev-parse --git-dir --git-common-dir --show-toplevel`, numa chamada.
 *  `gitDir !== commonDir` ⇔ linked worktree de um repo com working tree (o
 *  main NÃO é um worktree do próprio repo). Os paths são resolvidos contra
 *  `gitRoot` em vez de pedir `--path-format=absolute`: esse flag exige git
 *  ≥ 2.31 e o fallback silencioso degradaria para o DB por-worktree. */
function readGitPathsSync(gitRoot: string): { gitDir: string; commonDir: string; toplevel: string | null } | null {
	try {
		const stdout = execFileSync(
			"git",
			["-C", gitRoot, "rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"],
			{ timeout: 1000, windowsHide: true, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
		);
		const [gitDirRaw = "", commonDirRaw = "", toplevelRaw = ""] = stdout.split("\n").map((l) => l.trim());
		if (gitDirRaw === "" || commonDirRaw === "") return null;
		return {
			gitDir: resolve(gitRoot, gitDirRaw),
			commonDir: resolve(gitRoot, commonDirRaw),
			toplevel: toplevelRaw.length > 0 ? resolve(gitRoot, toplevelRaw) : null,
		};
	} catch {
		return null;
	}
}

/** Root COMPARTILHADO do repo — o checkout principal, não o worktree atual.
 *
 *  `findGitRoot` para no primeiro `.git`, que numa linked worktree é um arquivo
 *  do próprio worktree: o DB cairia em `<worktree>/.runecraft/memory` e
 *  desapareceria com `git worktree remove` (o contrato documentado é memória
 *  compartilhada). O caso só é tratado quando `.git` é ARQUIVO (submodule,
 *  `--separate-git-dir`, linked worktree) — checkout normal: zero chamadas
 *  extras de git.
 *
 *  - git-dir == git-common-dir → NÃO é linked worktree: submodule (git dir =
 *    `<super>/.git/modules/<n>`, main do repo interno é um "bare" lá dentro) ou
 *    main com `--separate-git-dir`. Root = `--show-toplevel` (o próprio
 *    checkout), o mesmo root de antes → submodules continuam isolados (testado
 *    com submodule real).
 *  - git-dir != git-common-dir → linked worktree: `git worktree list` lista o
 *    main primeiro. (`dirname` do `--git-common-dir`, usado pelos gates F20,
 *    erraria submodules e `--separate-git-dir`; este caminho acerta os dois.)
 *
 *  Git ilegível → o próprio gitRoot (comportamento anterior, nunca um path
 *  inventado). */
export function resolveSharedGitRootSync(start: string): string | null {
	const gitRoot = findGitRoot(start);
	if (!gitRoot) return null;
	if (!isGitFile(joinPath(gitRoot, ".git"))) return gitRoot;
	const paths = readGitPathsSync(gitRoot);
	if (!paths) return gitRoot;
	if (paths.gitDir === paths.commonDir) return paths.toplevel ?? gitRoot;
	return readMainWorktreeSync(gitRoot) ?? gitRoot;
}

/** Slug desambiguado de um remote que já perdeu o slug base para OUTRO
 *  remote no mesmo DB: `<slug>-<sha256(remoteUrl normalizado)[:len]>`.
 *  Determinístico e estável — a derived base slug (último segmento) nunca
 *  muda, então o primeiro projeto a reivindicar um slug mantém a identidade e
 *  nenhuma linha existente é reescrita (sem migração). O hash usa o remote
 *  NORMALIZADO (mesma forma que `sameRemote` compara), senão o mesmo repo via
 *  SSH e via HTTPS ganharia dois slugs desambiguados — e dois projetos. */
export function disambiguatedSlugForRemote(
	baseSlug: string,
	remoteUrl: string,
	length = 8,
): string {
	const digest = createHash("sha256").update(normalizeRemoteUrl(remoteUrl)).digest("hex");
	return `${baseSlug}-${digest.slice(0, length)}`;
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

	const gitRoot = resolveSharedGitRootSync(absoluteCwd);
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
