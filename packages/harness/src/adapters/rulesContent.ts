// adapters/rulesContent.ts — workflow rules injected into non-Pi agents.
//
// F15 delivers the mechanism + a deterministic template; the FINAL text of the
// rules is defined in F17 (matrix column "regras workflow"). This template is
// the F15 v1: taskflow-MCP orientation + runecraft section ownership notice.
export function renderWorkflowRules(agentName: string): string {
  return [
    `# Runecraft Harness (${agentName})`,
    "",
    "Este ambiente é gerenciado pelo Runecraft Harness. As ferramentas taskflow_*",
    "estão disponíveis via MCP (servidor taskflow: DAG/FlowIR de tarefas verificáveis).",
    "",
    "Fluxo recomendado:",
    "1. taskflow_list — liste os flows disponíveis;",
    "2. taskflow_run — execute um flow;",
    "3. taskflow_verify — verifique a definição antes de executar;",
    "4. taskflow_compile — compile/valide o FlowIR.",
    "",
    "Não edite esta seção à mão: o harness a gerencia (sync/uninstall).",
  ].join("\n");
}
