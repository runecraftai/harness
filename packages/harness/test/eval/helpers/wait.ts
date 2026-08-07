// eval/helpers/wait.ts — waits explícitos, nunca sleep mágico (D11).
//
// Edge da spec (CI lento): nenhum teste depende de timeout mágico; toda
// espera é condicional com timeout generoso e intervalo curto.
export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  label?: string;
}

export async function waitForCondition(fn: () => boolean, opts: WaitOptions = {}): Promise<boolean> {
  const { timeoutMs = 60_000, intervalMs = 100, label = "condition" } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Espera a promessa de exit de um ChildProcess (D11 — promessa de exit). */
export function waitForExit(child: { exitCode: number | null; on(event: "close", cb: (code: number | null) => void): unknown }): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.on("close", (code) => resolve(code));
  });
}
