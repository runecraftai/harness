// scenarios/recovery-flow.ts — EVAL-021: fluxo de recuperação pós-compactação
// (invariante F24 — sem phantom-block).
//
// Sessão glla REAL (single prompt): goal → 5 tasks → 3 completas → complete_goal
// BLOQUEADO pelo enforcer F24 (pendências 4 e 5) → completa 4 e 5 → complete_goal
// VERDE (o conjunto de recuperação é exatamente o que a continuação do F27
// re-injeta — mesma derivação do ledger — e é completável: sem deadlock AD-024).
//
// Delta vs EVAL-007 (D8 — sem double-test): EVAL-007 prova o MECANISMO do
// enforcer (pendências bloqueiam; tudo done conclui); este cenário prova o
// INVARIANTE de recuperação do F27 no fluxo: o conjunto pendente do ledger no
// momento da "compactação" (3/5) é exatamente o que a continuação re-injeta
// (EVAL-017/021-b) e completá-lo → complete_goal passa. O reason do enforcer
// NÃO é re-assertado além do marcador do fixture (D7c — evidência na ordem).
//
// Limitação honesta (QA-5/Execute): a EMISSÃO real de `session_compact` no
// fixture não é viável (requer limiar de contexto + sumarização LLM do SDK);
// o evento sintético é exercitado no wiring (handler exportado com eventos
// scriptados — extension.test.ts) e a observação real do evento em produção
// é o trigger primário (D1). Este cenário prova o lado do ENFORCER do fluxo.
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";
import * as fs from "node:fs";
import * as path from "node:path";

export default {
  id: "recovery-flow",
  title: "Recuperação pós-compactação: pendências do ledger completáveis → complete_goal verde",
  description:
    "EVAL-021: goal 3/5 → complete_goal BLOQUEADO (enforcer) → completa 4 e 5 → complete_goal verde (invariante F24 — sem phantom-block AD-024)",
  prompt:
    "/goal start Ship F27: create notes.txt with content 'recovery evidence'. Done when: notes.txt exists in the repo root with the exact content 'recovery evidence' and all five tasks are complete",
  withRepo: true,
  beforeSession: ({ repoDir }) => {
    // autoAcceptDrafts: o /goal start do fluxo confirma o draft sem diálogo
    // (formato validado no Execute — .pi-glla/settings.json).
    const dir = path.join(repoDir, ".pi-glla");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ autoAcceptDrafts: true }));
  },
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["propose_task_list"] },
        reply: {
          kind: "tool",
          name: "propose_task_list",
          args: {
            tasks: [
              { title: "Create notes.txt" },
              { title: "Task two" },
              { title: "Task three" },
              { title: "Task four" },
              { title: "Task five" },
            ],
          },
        },
      },
      {
        expect: { toolsSubset: ["write"] },
        reply: { kind: "tool", name: "write", args: { path: "notes.txt", content: "recovery evidence" } },
      },
      {
        expect: { toolsSubset: ["update_task_status"] },
        reply: { kind: "tool", name: "update_task_status", args: { id: "1", status: "complete" } },
      },
      {
        expect: { toolsSubset: ["update_task_status"] },
        reply: { kind: "tool", name: "update_task_status", args: { id: "2", status: "complete" } },
      },
      {
        expect: { toolsSubset: ["update_task_status"] },
        reply: { kind: "tool", name: "update_task_status", args: { id: "3", status: "complete" } },
      },
      // complete_goal com pendências (4,5) → BLOQUEADO pelo enforcer F24.
      {
        expect: { toolsSubset: ["complete_goal"] },
        reply: {
          kind: "tool",
          name: "complete_goal",
          args: { completionSummary: "three of five tasks done", verificationSummary: "<evidence>notes.txt exists</evidence>" },
        },
      },
      // O reason do bloqueio aparece na conversa do passo seguinte (D7c).
      {
        expect: { toolsSubset: ["update_task_status"], conversationContains: ["todo-continuation-enforcer"] },
        reply: { kind: "tool", name: "update_task_status", args: { id: "4", status: "complete" } },
      },
      {
        expect: { toolsSubset: ["complete_task"] },
        reply: { kind: "tool", name: "complete_task", args: { id: "5" } },
      },
      // Todas as pendências do ledger completas → complete_goal PASSA (sem
      // phantom-block — a continuação re-injeta exatamente este conjunto).
      {
        expect: { toolsSubset: ["complete_goal"] },
        reply: {
          kind: "tool",
          name: "complete_goal",
          args: {
            completionSummary: "all five tasks done",
            verificationSummary: "<evidence>notes.txt exists with content recovery evidence</evidence>",
          },
        },
      },
      {
        expect: { auditor: true },
        reply: { kind: "tool", name: "read", args: { path: "notes.txt" } },
      },
      {
        expect: { auditor: true },
        reply: {
          kind: "text",
          text: "<evidence>notes.txt exists with content recovery evidence and all five tasks are complete</evidence>\n<approved/>",
        },
      },
      // Continuação pós-aprovação do glla (tolerante quando não dispara).
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "The goal is complete. No further action needed." },
      },
    ]),
    id: "recovery-flow",
    description: "EVAL-021: recuperação pós-compactação — pendências do ledger completáveis → complete_goal verde",
  },
} satisfies HarnessScenario;
