// eval/layer2/fixture/scenarios.ts — ScriptedScenario por EVAL-ID (D6).
//
// Fonte única dos scripts da camada 2 (a EVAL-MATRIX.md é o espelho legível;
// o teste de consistência matriz ↔ testes impede entrada órfã — D9).
//
// Contador+switch: call N → passo N; fim do script → falha com a lista de
// calls esperadas (padrão gentle-ai). A única coisa fakeada é a ESCOLHA do
// tool call — o agente executa cada passo de verdade (bash/git reais no
// repo de teste descartável).
//
// Nomes de tools validados no Execute (F21 #6): glla = complete_goal,
// pause_goal, complete_task, update_task_status, propose_goal_draft,
// propose_loop_draft, propose_loop_refine, list_add, list_activate,
// list_status, propose_task_list; subagents = subagent, subagent_wait,
// subagent_supervisor, intercom; taskflow = taskflow; pr-review =
// self_review_subagent, pr_review_verify, review_subagent, review_subagents
// (loop tools ficam ocultas fora de um /pr-review ativo — validado no
// Execute: o ReviewLoopCoordinator esconde review_subagent etc.).

export interface ScenarioStepExpect {
  /** modelo exato do request (default "eval-model"). */
  model?: string;
  /** auditor: tools EXATAMENTE {read,grep,find,ls,bash} (F4 — isolamento). */
  auditor?: boolean;
  /** lista exata de tools do request. */
  tools?: string[];
  /** o request DEVE conter estas tools (robusto a extensões extra). */
  toolsSubset?: string[];
  /** marcadores que a conversa (mensagens do request) deve conter (D7c). */
  conversationContains?: string[];
}

export type ScenarioReply =
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "text"; text: string };

export interface ScriptedStep {
  expect?: ScenarioStepExpect;
  reply: ScenarioReply;
}

export interface ScriptedScenario {
  id: string;
  description: string;
  steps: ScriptedStep[];
  /** passo para a call N (1-based); undefined quando o script acabou. */
  stepFor(n: number): ScriptedStep | undefined;
  /** lista legível das calls esperadas (diagnóstico adversarial). */
  summary(): string;
}

export function script(steps: ScriptedStep[]): Omit<ScriptedScenario, "id" | "description"> {
  return {
    steps,
    stepFor(n: number): ScriptedStep | undefined {
      return n >= 1 && n <= steps.length ? steps[n - 1] : undefined;
    },
    summary(): string {
      return steps.map((s, i) => `${i + 1}:${s.reply.kind === "tool" ? s.reply.name : "text"}`).join(", ");
    },
  };
}

function conversation(marker: string) {
  return { conversationContains: [marker] };
}

const AUDITOR_APPROVED: ScriptedStep = {
  expect: { auditor: true },
  reply: {
    kind: "text",
    text: "<evidence>greeting.txt content is exactly 'hello harness' — verified by read.</evidence>\n<approved/>",
  },
};

/** EVAL-001 — goal trivial: /goal start → write real → complete_goal → auditor aprova. */
export const EVAL_001: ScriptedScenario = {
  id: "EVAL-001",
  description: "goal trivial (P1 camada 2): goal com 'Done when', implementação real (write), complete_goal com <evidence>, auditor isolado aprova",
  ...script([
    {
      expect: { toolsSubset: ["write"] },
      reply: { kind: "tool", name: "write", args: { path: "greeting.txt", content: "hello harness" } },
    },
    {
      expect: { toolsSubset: ["complete_goal"], ...conversation("hello harness") },
      reply: {
        kind: "tool",
        name: "complete_goal",
        args: {
          completionSummary: "greeting.txt criado com o conteúdo exato",
          verificationSummary: "<evidence>greeting.txt exists and its content is exactly 'hello harness'</evidence>",
        },
      },
    },
    {
      expect: { auditor: true },
      reply: { kind: "tool", name: "read", args: { path: "greeting.txt" } },
    },
    AUDITOR_APPROVED,
    // Continuação pós-aprovação do glla (determinística no fluxo com subagent;
    // tolerante quando não dispara): passo final benigno.
    {
      expect: { toolsSubset: ["read"] },
      reply: { kind: "text", text: "The goal is complete. No further action needed." },
    },
  ]),
};

/** EVAL-002 — goal ativo + subagent chain worker (F7 COEX-02): o subagent roda como worker (bash real). */
export const EVAL_002: ScriptedScenario = {
  id: "EVAL-002",
  description: "goal + subagent chain worker: subagent executa bash real no repo, chain completa, complete_goal sobrevive ao auditor",
  ...script([
    {
      expect: { toolsSubset: ["subagent"] },
      reply: {
        kind: "tool",
        name: "subagent",
        args: { agent: "worker", task: "Write worker.txt with the exact content 'worker-ran' using bash." },
      },
    },
    {
      expect: { toolsSubset: ["bash"] },
      reply: { kind: "tool", name: "bash", args: { command: "echo worker-ran > worker.txt" } },
    },
    {
      expect: { toolsSubset: ["read"] },
      reply: { kind: "text", text: "Subagent completed the task. worker.txt is written with the exact content." },
    },
    {
      expect: { toolsSubset: ["complete_goal"], ...conversation("worker-ran") },
      reply: {
        kind: "tool",
        name: "complete_goal",
        args: {
          completionSummary: "worker.txt escrito pelo subagent",
          verificationSummary: "<evidence>worker.txt exists with content exactly 'worker-ran'</evidence>",
        },
      },
    },
    {
      expect: { auditor: true },
      reply: { kind: "tool", name: "read", args: { path: "worker.txt" } },
    },
    AUDITOR_APPROVED,
    // Continuação pós-aprovação do glla no fluxo com subagent (empírico: o
    // complete_goal aprova e o glla envia um turno final "Goal approved");
    // passo tolerante quando a continuação não dispara.
    {
      expect: { toolsSubset: ["read"] },
      reply: { kind: "text", text: "The goal is complete. No further action needed." },
    },
  ]),
};

/**
 * EVAL-004 — review de diff (F7 COEX-04): subprocesso de review do pr-review
 * (--no-extensions → tools builtins apenas) lê o diff real e devolve o JSON
 * verdict. Validação no Execute: as tools de review do pr-review (review_subagent
 * etc.) ficam ocultas fora de um /pr-review ativo (gated por fonte interactive/
 * rpc + prompt do pacote) — o fluxo exercita o child exatamente como o fork
 * o spawna (buildReviewBaseArgs + PATH pi wrapper), mantendo o contrato JSON.
 */
export const EVAL_004: ScriptedScenario = {
  id: "EVAL-004",
  description: "review de diff: child do pr-review (builtins only) lê o diff e devolve verdict JSON estruturado",
  ...script([
    {
      expect: { tools: ["read", "bash", "edit", "write"] },
      reply: { kind: "tool", name: "read", args: { path: "feature.txt" } },
    },
    {
      expect: { tools: ["read", "bash", "edit", "write"] },
      reply: {
        kind: "text",
        text: JSON.stringify({
          verdict: "approve",
          overview: "small, correct change",
          strengths: ["adds the feature file"],
          findings: [],
          verification: "verified against exact head",
        }),
      },
    },
  ]),
};

/** EVAL-005 — hello world SDLC completo (F7 COEX-05): goal → dispatch subagent → auditor → review → complete_goal sobrevive. */
export const EVAL_005: ScriptedScenario = {
  id: "EVAL-005",
  description: "hello world SDLC completo: goal → dispatch subagent worker → auditor isolado → complete_goal sobrevive ao auditor (review em servidor dedicado — ver nota)",
  ...script([
    {
      expect: { toolsSubset: ["subagent"] },
      reply: {
        kind: "tool",
        name: "subagent",
        args: { agent: "worker", task: "Write greeting.txt with the exact content 'hello harness' using bash." },
      },
    },
    {
      expect: { toolsSubset: ["bash"] },
      reply: { kind: "tool", name: "bash", args: { command: "printf 'hello harness' > greeting.txt" } },
    },
    {
      expect: { toolsSubset: ["read"] },
      reply: { kind: "text", text: "Subagent completed the task. greeting.txt is written with the exact content." },
    },
    {
      expect: { toolsSubset: ["complete_goal"], ...conversation("hello harness") },
      reply: {
        kind: "tool",
        name: "complete_goal",
        args: {
          completionSummary: "greeting.txt escrito pelo subagent",
          verificationSummary: "<evidence>greeting.txt exists with content exactly 'hello harness'</evidence>",
        },
      },
    },
    {
      expect: { auditor: true },
      reply: { kind: "tool", name: "read", args: { path: "greeting.txt" } },
    },
    AUDITOR_APPROVED,
    {
      expect: { toolsSubset: ["read"] },
      reply: { kind: "text", text: "The goal is complete. No further action needed." },
    },
  ]),
};

/**
 * EVAL-006 — write sobre arquivo existente BLOQUEADO (F24 write-existing-file-guard).
 * O passo 2 exige o reason do guard na conversa (D7c — evidência na ordem): se o
 * guard regredir (parar de bloquear), o marcador some e o fixture falha com
 * diagnóstico. O alvo (README.md do repo) permanece intacto — a integridade é
 * a prova do bloqueio REAL no loop do Pi (não sugestão).
 */
export const EVAL_006: ScriptedScenario = {
  id: "EVAL-006",
  description: "write sobre arquivo existente bloqueado com reason estável; write em path novo passa; alvo intacto",
  ...script([
    {
      expect: { toolsSubset: ["write"] },
      reply: { kind: "tool", name: "write", args: { path: "README.md", content: "overwrite attempt" } },
    },
    {
      expect: { toolsSubset: ["write"], conversationContains: ["write-existing-file-guard"] },
      reply: { kind: "tool", name: "write", args: { path: "notes.txt", content: "fresh content" } },
    },
    {
      expect: { toolsSubset: ["read"] },
      reply: { kind: "text", text: "done" },
    },
  ]),
};

/**
 * EVAL-007 — todo guards (F24): `propose_task_list` com input reescrito para o
 * formato canônico "Done when" + `complete_goal` BLOQUEADO com pendências
 * (todo-continuation-enforcer) + conclusão após completar tudo. O passo 3 exige
 * o reason do enforcer na conversa (o complete_goal do passo 2 foi bloqueado —
 * evidência na ordem); o ledger guarda os títulos canônicos (a reescrita é
 * REAL: o tool executou com o input reescrito).
 */
export const EVAL_007: ScriptedScenario = {
  id: "EVAL-007",
  description: "todo override reescreve input (Done when) + enforcer bloqueia complete_goal com pendências; tudo done → conclui",
  ...script([
    {
      expect: { toolsSubset: ["propose_task_list"] },
      reply: {
        kind: "tool",
        name: "propose_task_list",
        args: { tasks: [{ title: "Create notes.txt" }, { title: "Update README" }] },
      },
    },
    {
      expect: { toolsSubset: ["write"] },
      reply: { kind: "tool", name: "write", args: { path: "notes.txt", content: "hello todo" } },
    },
    {
      expect: { toolsSubset: ["complete_goal"] },
      reply: { kind: "tool", name: "complete_goal", args: { completionSummary: "all tasks done" } },
    },
    {
      expect: { toolsSubset: ["update_task_status"], conversationContains: ["todo-continuation-enforcer"] },
      reply: { kind: "tool", name: "update_task_status", args: { id: "1", status: "complete" } },
    },
    {
      expect: { toolsSubset: ["complete_task"] },
      reply: { kind: "tool", name: "complete_task", args: { id: "2" } },
    },
    {
      expect: { toolsSubset: ["complete_goal"] },
      reply: { kind: "tool", name: "complete_goal", args: { completionSummary: "all tasks done", verificationSummary: "<evidence>notes.txt exists with content hello todo</evidence>" } },
    },
    {
      expect: { auditor: true },
      reply: { kind: "tool", name: "read", args: { path: "notes.txt" } },
    },
    AUDITOR_APPROVED,
    // Continuação pós-aprovação do glla (tolerante quando não dispara).
    {
      expect: { toolsSubset: ["read"] },
      reply: { kind: "text", text: "The goal is complete. No further action needed." },
    },
  ]),
};

export const SCENARIOS: Record<string, ScriptedScenario> = {
  "EVAL-001": EVAL_001,
  "EVAL-002": EVAL_002,
  "EVAL-004": EVAL_004,
  "EVAL-005": EVAL_005,
  "EVAL-006": EVAL_006,
  "EVAL-007": EVAL_007,
};
