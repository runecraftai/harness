// routing/materialize.test.ts — unit da materialização das pilot chains
// (F33, T4; D4 — three-way F19 D7 + contentHash F13).
//
// Cobre: 1ª install copia byte-idêntico aos assets, idempotente (in-sync),
// edição do usuário → "preservado (editado)" e NUNCA reescrita, template
// mudou → updated (vN→vM), adopted (arquivo == asset sem registro), órfãos
// nunca removidos, alvo .pi/chains/ REUSADO do F30 (mesmo dir das chains
// SDD), fork ausente → dados inertes (assets válidos independente do fork).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PILOT_CHAIN_NAMES,
  PILOT_CHAIN_ASSETS_VERSION,
  pilotChainsAssetsDir,
  pilotChainsDir,
  planPilotChains,
  applyPilotChains,
  contentHash,
  readPilotChainAsset,
  packageRoot,
  type PilotChainName,
  type PilotChainRecord,
} from "../../src/routing/materialize.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "routing-mat-"));
}

function readAsset(name: PilotChainName): string {
  const content = readPilotChainAsset(name, packageRoot());
  if (content === null) throw new Error(`asset ${name}.chain.md ausente`);
  return content;
}

describe("assets — 5 pilot chains versionadas (D4)", () => {
  test("formato no contrato do parser REAL do fork subagents (validado no Execute F33 — chain-serializer parseChain)", async () => {
    // Validação no Execute F33 (parser REAL do fork 0.37.2 —
    // node_modules/@runecraft/subagents/src/agents/chain-serializer.ts
    // parseChain:101): as 5 pilot chains PARSEIAM no formato que o fork
    // consome HOJE (front-matter name+description + seções `## <agente>`; o
    // f3-taskflow histórico `worker "..." -> reviewer "..."` NÃO parseia).
    // Resultado do Execute: implement=[builder, reviewer, builder],
    // plan=[planner, reviewer, builder, reviewer], research=[researcher],
    // explore=[scout], security=[builder, security, builder, reviewer]. O
    // teste codifica o contrato (não importa o source do fork — mesmo
    // padrão EVAL-046: zero acoplamento com o package).
    const expected: Record<PilotChainName, string[]> = {
      implement: ["builder", "reviewer", "builder"],
      plan: ["planner", "reviewer", "builder", "reviewer"],
      research: ["researcher"],
      explore: ["scout"],
      security: ["builder", "security", "builder", "reviewer"],
    };
    for (const name of PILOT_CHAIN_NAMES) {
      const content = readAsset(name);
      // Front-matter name + description obrigatórios (parseChain exige).
      expect(content.startsWith(`---\nname: ${name}\n`)).toBe(true);
      expect(content).toMatch(/^description: ".+"$/m);
      // Seções `## <agente>` na ordem exata (passos da chain — D4).
      const steps = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
      expect(steps).toEqual(expected[name]);
      // Corpo da seção presente (task do passo — parseStepBody).
      for (const step of steps) {
        const section = content.split(`## ${step}`)[1] ?? "";
        expect(section.trim().length).toBeGreaterThan(0);
      }
    }
  });
  test("os 5 assets existem e são byte-idênticos ao que o materialize copia", () => {
    for (const name of PILOT_CHAIN_NAMES) {
      const file = path.join(pilotChainsAssetsDir(), `${name}.chain.md`);
      expect(fs.existsSync(file), `${name}.chain.md ausente`).toBe(true);
      expect(readPilotChainAsset(name, packageRoot())).toBe(fs.readFileSync(file, "utf8"));
    }
  });

  test("formato do fork: front-matter name+description + seções ## <agente>", () => {
    for (const name of PILOT_CHAIN_NAMES) {
      const content = readAsset(name);
      expect(content.startsWith("---\nname:")).toBe(true);
      expect(content).toMatch(/^description: ".+"/m);
      const steps = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
      expect(steps.length).toBeGreaterThan(0);
      // Passos = ids de papel F32 (builder/reviewer/planner/scout/researcher/security).
      for (const step of steps) {
        expect(["builder", "reviewer", "planner", "scout", "researcher", "security"]).toContain(step);
      }
      // Zero RPG: o nome do front-matter (name: explore — identificador
      // MANDATÓRIO da rota, filename == name no fork) é excluído do scan
      // ("explore" contém "lore" — edge documentado no catalog F32);
      // descrição + corpo não podem conter termos de RPG/persona de classe.
      const scan = content.replace(/^name: .+$/m, "");
      for (const term of ["bard", "wizard", "ranger", "fighter", "warlock", "cleric", "paladin", "rogue", "thread", "saga", "ultrawork"]) {
        expect(scan.toLowerCase(), `${name}.chain.md contém termo proibido "${term}"`).not.toContain(term);
      }
    }
  });

  test("gate de veredito presente nas chains com review (implement/plan/security)", () => {
    for (const name of ["implement", "plan", "security"] as const) {
      const content = readAsset(name);
      expect(content).toContain("[APPROVE]");
      expect(content).toContain("[REJECT]");
      expect(content).toMatch(/3 blocking issues/);
    }
  });
});

describe("planPilotChains — three-way por conteúdo (F19 D7)", () => {
  test("1ª install: ausentes → missing (todas as 5)", () => {
    const base = tmpDir();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const plans = planPilotChains(repo, undefined);
      expect(plans.map((p) => p.name)).toEqual([...PILOT_CHAIN_NAMES]);
      for (const plan of plans) expect(plan.status).toBe("missing");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("apply copia byte-idêntico aos assets e registra no state (contentHash F13)", () => {
    const base = tmpDir();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const piChains: Record<string, PilotChainRecord> = {};
      const plans = planPilotChains(repo, piChains);
      const result = applyPilotChains(repo, piChains, plans);
      expect(result.copied.length).toBe(PILOT_CHAIN_NAMES.length);
      expect(result.changed).toBe(true);
      for (const name of PILOT_CHAIN_NAMES) {
        const file = path.join(pilotChainsDir(repo), `${name}.chain.md`);
        expect(fs.existsSync(file)).toBe(true);
        expect(fs.readFileSync(file, "utf8")).toBe(readAsset(name)); // byte-idêntico
        expect(piChains[name]!.contentHash).toBe(contentHash(readAsset(name)));
        expect(piChains[name]!.assetVersion).toBe(PILOT_CHAIN_ASSETS_VERSION);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("idempotente: 2ª run → in-sync, zero writes", () => {
    const base = tmpDir();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const piChains: Record<string, PilotChainRecord> = {};
      applyPilotChains(repo, piChains, planPilotChains(repo, piChains));
      const before = fs.readFileSync(path.join(pilotChainsDir(repo), "implement.chain.md"), "utf8");
      const plans2 = planPilotChains(repo, piChains);
      for (const plan of plans2) expect(plan.status).toBe("in-sync");
      const result2 = applyPilotChains(repo, piChains, plans2);
      expect(result2.copied).toEqual([]);
      expect(result2.changed).toBe(false);
      expect(fs.readFileSync(path.join(pilotChainsDir(repo), "implement.chain.md"), "utf8")).toBe(before);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("usuário editou → preserved (editado) e NUNCA reescrita (F19 D7)", () => {
    const base = tmpDir();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const piChains: Record<string, PilotChainRecord> = {};
      applyPilotChains(repo, piChains, planPilotChains(repo, piChains));
      // Usuário edita implement.chain.md (corpo muda; registro continua o antigo).
      const file = path.join(pilotChainsDir(repo), "implement.chain.md");
      const edited = readAsset("implement") + "\n# nota do usuário\n";
      fs.writeFileSync(file, edited, "utf8");
      const plans = planPilotChains(repo, piChains);
      const plan = plans.find((p) => p.name === "implement")!;
      expect(plan.status).toBe("edited");
      const result = applyPilotChains(repo, piChains, plans);
      expect(result.copied).toEqual([]);
      expect(fs.readFileSync(file, "utf8")).toBe(edited); // zero writes
      expect(result.notes.some((n) => n.includes("preservado (editado"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("template mudou (arquivo == registrado ≠ asset) → updated (vN→vM)", () => {
    const base = tmpDir();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const piChains: Record<string, PilotChainRecord> = {};
      applyPilotChains(repo, piChains, planPilotChains(repo, piChains));
      // Simula asset novo: o arquivo materializado == registrado, mas difere do
      // asset atual → template mudou.
      const file = path.join(pilotChainsDir(repo), "research.chain.md");
      fs.writeFileSync(file, readAsset("research") + "\n# template antigo\n", "utf8");
      // Registro aponta para o conteúdo ANTIGO (igual ao arquivo atual).
      piChains.research = { ...piChains.research!, contentHash: contentHash(readAsset("research") + "\n# template antigo\n") };
      const plans = planPilotChains(repo, piChains);
      const plan = plans.find((p) => p.name === "research")!;
      expect(plan.status).toBe("updated");
      const result = applyPilotChains(repo, piChains, plans);
      expect(result.copied).toContain("research.chain.md");
      expect(fs.readFileSync(file, "utf8")).toBe(readAsset("research")); // atualizada
      expect(result.notes.some((n) => n.includes("atualizado (template"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("arquivo == asset sem registro → adopted (registra sem escrita)", () => {
    const base = tmpDir();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      // Arquivo já presente (usuário copiou) sem registro no state.
      fs.mkdirSync(pilotChainsDir(repo), { recursive: true });
      fs.writeFileSync(path.join(pilotChainsDir(repo), "explore.chain.md"), readAsset("explore"), "utf8");
      const piChains: Record<string, PilotChainRecord> = {};
      const plans = planPilotChains(repo, piChains);
      const plan = plans.find((p) => p.name === "explore")!;
      expect(plan.status).toBe("adopted");
      const result = applyPilotChains(repo, piChains, plans);
      expect(result.copied).not.toContain("explore.chain.md");
      expect(piChains.explore).toBeDefined();
      expect(result.notes.some((n) => n.includes("adotado sem escrita"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("chains SDD do F30 coexistem no MESMO alvo .pi/chains/ (QA-3a — reuso, sem duplicação)", () => {
    const base = tmpDir();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      // Simula o F30 já materializado: sdd-tasks.chain.md presente.
      const dest = path.join(pilotChainsDir(repo), "sdd-tasks.chain.md");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, "# sdd-tasks\n", "utf8");
      const piChains: Record<string, PilotChainRecord> = {};
      const result = applyPilotChains(repo, piChains, planPilotChains(repo, piChains));
      expect(result.copied.length).toBe(PILOT_CHAIN_NAMES.length);
      // O arquivo do F30 continua intacto (nunca tocado pelas pilot chains).
      expect(fs.readFileSync(dest, "utf8")).toBe("# sdd-tasks\n");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
