// capabilities/manifest.test.ts — B0: capability manifest (fonte única).
//
// Espelho do manifest_test.go do gentle-ai (digest tests — recon §5/§7):
// validação estrutural, digest byte-estável (2 runs idênticos — F21 D10),
// cobertura por agente/capability, contratos delivered↔verdict, e o wiring
// do capabilityReason (matrix.ts consome o MESMO texto — sem drift).
import { describe, expect, test } from "bun:test";
import {
  CAPABILITY_IDS,
  CAPABILITY_MANIFEST,
  MANIFEST_AGENT_IDS,
  allManifests,
  canonicalManifestJson,
  capabilityReason,
  claimFor,
  deliveredClaims,
  manifestDigest,
  manifestFor,
  validateManifest,
  type ManifestAgentId,
} from "../../src/capabilities/manifest.ts";
import { MATRIX } from "../../src/matrix.ts";

describe("validateManifest — estrutura (B0)", () => {
  test("todos os agentes suportados cobrem todas as capabilities", () => {
    const validation = validateManifest();
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    for (const agent of MANIFEST_AGENT_IDS) {
      const manifest = manifestFor(agent);
      for (const capability of CAPABILITY_IDS) {
        expect(manifest[capability], `${agent}.${capability}`).toBeDefined();
      }
    }
  });

  test("claims entregues hoje: cobertura honesta (5 agentes × 11 capabilities)", () => {
    // Projeção honesta: nenhum agente com verdict none pode estar delivered;
    // todo delivered tem mechanism não-vazio.
    for (const agent of MANIFEST_AGENT_IDS) {
      for (const capability of CAPABILITY_IDS) {
        const claim = claimFor(agent, capability);
        expect(claim.mechanism.length).toBeGreaterThan(0);
        if (claim.delivered) expect(claim.verdict).not.toBe("none");
        if (claim.verdict === "done") expect(claim.delivered).toBe(true);
      }
    }
  });

  test("detect-only (cursor/grok) NÃO têm manifest — Tier 3 sem claims (recon §7)", () => {
    const all = allManifests().map((m) => m.agent);
    expect(all).not.toContain("cursor");
    expect(all).not.toContain("grok");
  });

  test("Copilot guards/hooks = none (honestidade do recon §4.4/§7 — sem superfície)", () => {
    expect(claimFor("copilot", "guards").verdict).toBe("none");
    expect(claimFor("copilot", "hooks").verdict).toBe("none");
    expect(claimFor("copilot", "guards").delivered).toBe(false);
  });

  test("goal-loop excluído do v1 não-Pi (decisão D2 — taskflow + subagents são os substitutos)", () => {
    for (const agent of ["claude-code", "opencode", "codex", "copilot"] as const) {
      const claim = claimFor(agent, "goal-loop");
      expect(claim.verdict).toBe("none");
      expect(claim.delivered).toBe(false);
      expect(claim.note).toContain("excluded from non-Pi v1 (D2)");
    }
  });

  test("B1: claude-code subagents entregue via superfície nativa (agent files + Task tool)", () => {
    const claim = claimFor("claude-code", "subagents");
    expect(claim.verdict).toBe("native");
    expect(claim.delivered).toBe(true);
    expect(claim.mechanism).toContain("~/.claude/agents/");
    expect(claim.mechanism).toContain("Task tool");
  });

  test("F4: dimensão routing dedicada — honesta por agente (claude-code entregue; demais não)", () => {
    // A dimensão routing é DEDICADA (não reusa persona): claude-code entregue
    // via seção runecraft:routing (B1); opencode/codex adapt (regras); copilot
    // none. Os motivos das células unsupported da matriz NUNCA leem entregue
    // para um agente sem a capacidade.
    expect(claimFor("claude-code", "routing").verdict).toBe("native");
    expect(claimFor("claude-code", "routing").delivered).toBe(true);
    expect(claimFor("claude-code", "routing").mechanism).toContain("runecraft:routing");
    expect(claimFor("opencode", "routing").delivered).toBe(false);
    expect(claimFor("codex", "routing").delivered).toBe(false);
    expect(claimFor("copilot", "routing").verdict).toBe("none");
    // reason do opencode routing: planned (nunca "nativo entregue").
    expect(capabilityReason("opencode", "routing", "routing")).toContain("planned:");
    expect(capabilityReason("opencode", "routing", "routing")).not.toContain("nativo entregue");
  });

  test("F4: reason de capacidade ENTREGUE diz 'nativo entregue' (sem contradição com o fork Pi-only)", () => {
    const reason = capabilityReason("claude-code", "subagents", "subagents");
    expect(reason).toContain("subagents é extensão Pi; use --agent pi");
    expect(reason).toContain("nativo entregue:");
    expect(reason).not.toContain("(native)");
  });
});

describe("digest (manifest_test.go pattern — byte-stável)", () => {
  test("canonical JSON determinístico: 2 runs idênticos (F21 D10)", () => {
    expect(canonicalManifestJson()).toBe(canonicalManifestJson());
    expect(manifestDigest()).toBe(manifestDigest());
    expect(manifestDigest()).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("todos os agentes × capabilities na ordem canônica", () => {
    const json = JSON.parse(canonicalManifestJson()) as Record<string, Record<string, unknown>>;
    expect(Object.keys(json)).toEqual([...MANIFEST_AGENT_IDS]);
    for (const agent of MANIFEST_AGENT_IDS) {
      expect(Object.keys(json[agent]!)).toEqual([...CAPABILITY_IDS]);
    }
  });
});

describe("capabilityReason — fonte única para matrix.ts (sem drift)", () => {
  test("motivo do claude-code subagents contém o mecanismo nativo B1", () => {
    const reason = capabilityReason("claude-code", "subagents", "subagents");
    expect(reason).toContain("subagents é extensão Pi; use --agent pi");
    expect(reason).toContain("agent files");
    expect(reason).toContain("Task tool");
  });

  test("matrix.ts consome os motivos do manifest (as células unsupported usam capabilityReason)", () => {
    // O texto das células da matriz NÃO pode divergir do manifest: para os
    // pares componente×capability mapeados, o reason da célula é o do manifest.
    const claudeSubagents = MATRIX["claude-code"].subagents;
    expect(claudeSubagents?.kind).toBe("unsupported");
    if (claudeSubagents?.kind === "unsupported") {
      expect(claudeSubagents.reason).toBe(capabilityReason("claude-code", "subagents", "subagents"));
    }
    const copilotGuards = MATRIX.copilot.guards;
    if (copilotGuards?.kind === "unsupported") {
      expect(copilotGuards.reason).toBe(capabilityReason("copilot", "guards", "guards"));
    }
  });

  test("claims planejadas carregam a fase do PARITY.md", () => {
    // B2 hooks/guards (Claude + Codex), B3 memory, B4 pr-review, B5 models, B6 sdds.
    expect(claimFor("claude-code", "guards").phase).toBe("B2");
    expect(claimFor("codex", "hooks").phase).toBe("B2");
    expect(claimFor("claude-code", "memory").phase).toBe("B3");
    expect(claimFor("claude-code", "pr-review").phase).toBe("B4");
    expect(claimFor("claude-code", "models").phase).toBe("B5");
    expect(claimFor("opencode", "sdds").phase).toBe("B6");
  });
});

describe("deliveredClaims — projeção honesta", () => {
  test("pi entrega tudo (referência); claude-code entrega subagents+taskflow+mcp+persona", () => {
    const pi = deliveredClaims("pi").map((c) => c.capability);
    expect(pi).toHaveLength(CAPABILITY_IDS.length);
    const claude = deliveredClaims("claude-code").map((c) => c.capability);
    // B1: subagents agora entregue via superfície nativa.
    expect(claude).toContain("subagents");
    expect(claude).toContain("taskflow");
    expect(claude).toContain("mcp");
    expect(claude).not.toContain("guards");
    expect(claude).not.toContain("goal-loop");
  });

  test("CAPABILITY_MANIFEST é a fonte única (mutação não reflete)", () => {
    // O objeto exportado é a leitura do status/doctor — congelar a shape não
    // é necessário (TS), mas o digest é o contrato: mudança de claim muda o
    // digest e o golden do doctor captura o drift.
    expect(Object.keys(CAPABILITY_MANIFEST).sort()).toEqual([...MANIFEST_AGENT_IDS].sort());
    expect((Object.keys(CAPABILITY_MANIFEST) as ManifestAgentId[]).every((a) => a in CAPABILITY_MANIFEST)).toBe(true);
  });
});
