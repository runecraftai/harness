// agents/prompt-utils.ts — utilidades de prompt (F32, D4; ROLE-04).
//
// Port fiel do `isAgentEnabled` do arcanum (src/agents/prompt-utils.ts —
// lido no Execute F32): um agente está habilitado quando seu nome NÃO está
// na lista de desabilitados. Semântica source: lista ausente/vazia → todos
// habilitados; match por nome exato (case-sensitive — nomes de agente são
// lowercase por convenção do fork).
//
// Módulo PURO (F21 D10).
export function isAgentEnabled(name: string, disabled?: string[]): boolean {
  if (!disabled || disabled.length === 0) return true;
  return !disabled.includes(name);
}
