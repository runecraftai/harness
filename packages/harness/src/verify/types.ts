// verify/types.ts — dependências injetáveis da cascata (F25, D1/D6).
//
// A engine é pura e determinística dado o input; as únicas fronteiras de I/O
// entram por injeção (testes usam fakes — spy de chamadas, zero rede):
//   - RunCommand    — executor da camada 1 (structural; default = Bun.spawn)
//   - JudgeAdapter  — chamada LLM da camada 5 (env-gated; default = ausente →
//                     fail-closed com diagnóstico; testes injetam fake LLM)
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type RunCommand = (cmd: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv) => Promise<CommandResult>;

export interface JudgeRequest {
  prompt: string;
  timeoutMs: number;
}

export type JudgeReply = { ok: true; raw: string } | { ok: false; error: string };

/** Adaptador do judge (D6 — read-only, env-gated pelo caller da engine). */
export type JudgeAdapter = (request: JudgeRequest) => Promise<JudgeReply>;

/** Dependências injetáveis da cascata (defaults: executor real, sem judge). */
export interface VerifyDeps {
  runCommand?: RunCommand;
  judgeAdapter?: JudgeAdapter;
}
