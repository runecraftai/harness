// lock.ts — write lock between harness operations (F18 Riscos: corrida com
// outro installer em paralelo). Validado no Execute: bun/Node não expõem
// flock portátil — mkdir atômico é o padrão npm/apt (a criação falha se o
// dir já existe). Stale lock (> 5 min) é removido e retomado.
import * as fs from "node:fs";
import * as path from "node:path";
import { runecraftDir, type Runtime, type Scope } from "./config.ts";

const STALE_MS = 5 * 60 * 1000;

function tryAcquire(dir: string): boolean {
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.mkdirSync(dir, { recursive: false });
    fs.writeFileSync(path.join(dir, "pid"), `${process.pid}\n`, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
    return false;
  }
}

function isStale(dir: string): boolean {
  try {
    const stat = fs.statSync(dir);
    return Date.now() - stat.mtimeMs > STALE_MS;
  } catch {
    return false; // sumiu — quem chamou decide
  }
}

/**
 * Runs `fn` holding a per-operation lock (`<runecraft>/.lock/<op>`). Throws
 * when another operation holds it (and it is not stale). The lock covers the
 * whole command body — including TTY prompts — so a parallel gentle-ai
 * sync/harness run cannot interleave writes (backup F13 still guarantees
 * restore on conflict).
 */
export async function withRunecraftLock<T>(
  rt: Runtime,
  scope: Scope,
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  const base = path.join(runecraftDir(rt, scope), ".lock");
  const dir = path.join(base, op);
  if (!tryAcquire(dir)) {
    if (isStale(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // outra corrida removeu — tenta adquirir de novo abaixo
      }
      if (!tryAcquire(dir)) {
        throw new Error(
          `outra operação '${op}' do harness está em andamento (lock: ${dir}) — espere ou remova o dir manualmente se o processo morreu há < 5 min`,
        );
      }
    } else {
      throw new Error(
        `outra operação '${op}' do harness está em andamento (lock: ${dir}) — espere ou remova o dir manualmente se o processo morreu há < 5 min`,
      );
    }
  }
  try {
    // Heartbeat: atualiza o mtime do lock a cada 30s — um prompt TTY aberto
    // por > 5 min não pode fazer o lock parecer stale para outra instância
    // (fix review F18). O pid fica no dir para diagnóstico manual.
    const heartbeat = setInterval(() => {
      try {
        fs.utimesSync(dir, new Date(), new Date());
      } catch {
        // dir sumiu (remoção manual) — o finally abaixo trata
      }
    }, 30_000);
    try {
      return await fn();
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort: lock órfão é recuperado pelo stale
    }
  }
}
