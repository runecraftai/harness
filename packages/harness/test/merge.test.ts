// merge.test.ts — F14 settings merge engine (SETM-01..06): overlay por targets
// (file/scope/prefix), idempotência, conflito reportado sem clobber, JSON
// inválido aborta (SETM-04), mode remove (SETM-05) e atribuição por componente.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  makeSandbox,
  readJson,
  settingsFile,
  type Sandbox,
} from "./helpers.ts";
import {
  applyMerge,
  componentForSettingsChange,
  MergeError,
  removeSettingsChanges,
  targetsForComponents,
  TASKFLOW_MODEL_ROLES,
  type MergeTarget,
} from "../src/merge.ts";
import { piSettingsPath, type Runtime, type Scope } from "../src/config.ts";
import type { SettingsChange } from "../src/state.ts";

const FULL_COMPONENTS = ["subagents", "taskflow", "goal-loop-audit", "pr-review"];

function rt(sb: Sandbox): Runtime {
  return { cwd: sb.dir, env: sb.env };
}

function writeRaw(sb: Sandbox, content: string): void {
  fs.mkdirSync(sb.piHome, { recursive: true });
  fs.writeFileSync(settingsFile(sb), content, "utf8");
}

function writeDoc(sb: Sandbox, doc: Record<string, unknown>): void {
  writeRaw(sb, JSON.stringify(doc, null, 2));
}

function fullTargets(scope: Scope): MergeTarget[] {
  return targetsForComponents(FULL_COMPONENTS, scope);
}

describe("applyMerge — overlay de defaults (SETM-01)", () => {
  test("chaves ausentes criadas; arquivo com packages preservado", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, { packages: ["npm:@runecraft/subagents"] });
      const outcome = applyMerge(fullTargets("global"), rt(sb));

      expect(outcome.filesWritten).toEqual([settingsFile(sb)]);
      expect(outcome.created.map((c) => c.path.join(".")).sort()).toEqual([
        "modelRoles",
        "subagents.modelScope.enforce",
        "taskflow.piChild.resourceProfile",
      ]);
      expect(outcome.conflicts).toEqual([]);

      const doc = readJson(settingsFile(sb));
      expect(doc.packages).toEqual(["npm:@runecraft/subagents"]); // desconhecido intacto
      expect(doc.subagents).toEqual({ modelScope: { enforce: false } });
      expect(doc.taskflow).toEqual({ piChild: { resourceProfile: "isolated" } });
      expect(doc.modelRoles).toEqual(TASKFLOW_MODEL_ROLES);
      // cada created carrega o valor exato aplicado (→ settingsChanges, SETM-03)
      const modelRoles = outcome.created.find((c) => c.path.join(".") === "modelRoles");
      expect(modelRoles?.value).toEqual(TASKFLOW_MODEL_ROLES);
    } finally {
      sb.cleanup();
    }
  });

  test("merge profundo por chave: chave do usuário preservada, demais criadas", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, {
        packages: [],
        subagents: { defaultModel: "meu/abc", modelScope: { allow: ["*"] } },
      });
      const outcome = applyMerge(fullTargets("global"), rt(sb));

      const doc = readJson(settingsFile(sb));
      // usuário vence; bloco não é substituído
      expect((doc.subagents as { defaultModel: string }).defaultModel).toBe("meu/abc");
      // modeloScope: allow preservado, enforce criado (deep merge dentro do bloco)
      const modelScope = (doc.subagents as { modelScope: { enforce: boolean; allow: string[] } }).modelScope;
      expect(modelScope.allow).toEqual(["*"]);
      expect(modelScope.enforce).toBe(false);
      expect(outcome.created.map((c) => c.path.join("."))).toContain("subagents.modelScope.enforce");
      expect(outcome.conflicts).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("conflito reportado (path + valor dos dois lados), nunca clobber (SETM-02)", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, { taskflow: { piChild: { resourceProfile: "allowlist" } } });
      const outcome = applyMerge(fullTargets("global"), rt(sb));

      const conflict = outcome.conflicts.find((c) => c.path.join(".") === "taskflow.piChild.resourceProfile");
      expect(conflict).toBeDefined();
      expect(conflict?.value).toBe("allowlist"); // valor do usuário
      expect(conflict?.harness).toBe("isolated"); // default do harness
      // arquivo não foi tocado por causa do conflito isolado? não: outras chaves
      // foram criadas; o valor conflitante permanece o do usuário
      const doc = readJson(settingsFile(sb));
      expect((doc.taskflow as { piChild: { resourceProfile: string } }).piChild.resourceProfile).toBe("allowlist");
      // conflito NÃO entra em created (não é adição do harness)
      expect(outcome.created.map((c) => c.path.join("."))).not.toContain("taskflow.piChild.resourceProfile");
    } finally {
      sb.cleanup();
    }
  });

  test("scalar em segmento intermediário → conflito reportado, nunca clobber (edge SETM)", async () => {
    const sb = makeSandbox();
    try {
      const targets: MergeTarget[] = [
        { component: "subagents", file: "settings", scope: "global", prefix: ["subagents"], defaults: [{ path: ["modelScope", "enforce"], value: false }] },
      ];

      // caso 1: o prefixo inteiro é um scalar → bloqueado na raiz do bloco
      writeDoc(sb, { subagents: "oops" });
      const outcome = applyMerge(targets, rt(sb));
      expect(outcome.created).toEqual([]);
      expect(outcome.filesWritten).toEqual([]); // nada escrito
      expect(outcome.conflicts).toHaveLength(1);
      expect(outcome.conflicts[0]?.path).toEqual(["subagents"]);
      expect(outcome.conflicts[0]?.value).toBe("oops"); // valor do usuário
      expect(outcome.conflicts[0]?.harness).toEqual({ modelScope: { enforce: false } }); // subtree do harness
      expect(readJson(settingsFile(sb)).subagents).toBe("oops"); // intacto

      // caso 2: scalar mais fundo no caminho → bloqueado no segmento exato
      writeDoc(sb, { subagents: { modelScope: "oops" } });
      const outcome2 = applyMerge(targets, rt(sb));
      expect(outcome2.created).toEqual([]);
      expect(outcome2.conflicts).toHaveLength(1);
      expect(outcome2.conflicts[0]?.path).toEqual(["subagents", "modelScope"]);
      expect(outcome2.conflicts[0]?.value).toBe("oops");
      expect(outcome2.conflicts[0]?.harness).toEqual({ enforce: false });
      expect((readJson(settingsFile(sb)).subagents as { modelScope: unknown }).modelScope).toBe("oops");
    } finally {
      sb.cleanup();
    }
  });

  test("idempotente: re-aplicar → zero mudanças e zero writes (edge SETM)", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, { packages: [] });
      const first = applyMerge(fullTargets("global"), rt(sb));
      const before = fs.readFileSync(settingsFile(sb), "utf8");
      const second = applyMerge(fullTargets("global"), rt(sb));

      expect(first.created).toHaveLength(3);
      expect(second.created).toEqual([]);
      expect(second.conflicts).toEqual([]);
      expect(second.filesWritten).toEqual([]);
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe(before);
    } finally {
      sb.cleanup();
    }
  });

  test("chaves desconhecidas de outros packages intactas (edge SETM)", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, { packages: [], outroPackage: { qualquer: [1, 2, 3] }, defaultThinkingLevel: "high" });
      applyMerge(fullTargets("global"), rt(sb));
      const doc = readJson(settingsFile(sb));
      expect(doc.outroPackage).toEqual({ qualquer: [1, 2, 3] });
      expect(doc.defaultThinkingLevel).toBe("high");
    } finally {
      sb.cleanup();
    }
  });

  test("arrays são atômicos: usuário vence; ausente recebe default", async () => {
    const sb = makeSandbox();
    try {
      // target custom com default array
      writeDoc(sb, { target: { list: ["a"] } });
      const targets: MergeTarget[] = [
        { component: "subagents", file: "settings", scope: "global", prefix: ["target"], defaults: [{ path: ["list"], value: ["x", "y"] }] },
      ];
      const outcome = applyMerge(targets, rt(sb));
      // existente → conflito (substituição nunca acontece)
      expect(outcome.conflicts).toHaveLength(1);
      expect(outcome.created).toEqual([]);
      expect((readJson(settingsFile(sb)).target as { list: string[] }).list).toEqual(["a"]);

      // ausente → aplica default
      writeDoc(sb, {});
      const outcome2 = applyMerge(targets, rt(sb));
      expect(outcome2.created.map((c) => c.path.join("."))).toEqual(["target.list"]);
      expect((readJson(settingsFile(sb)).target as { list: string[] }).list).toEqual(["x", "y"]);
    } finally {
      sb.cleanup();
    }
  });

  test("arquivo alvo ausente → criado com só os defaults (sem órfãos)", async () => {
    const sb = makeSandbox();
    try {
      expect(fs.existsSync(settingsFile(sb))).toBe(false);
      const outcome = applyMerge(fullTargets("global"), rt(sb));
      expect(outcome.filesWritten).toEqual([settingsFile(sb)]);
      const doc = readJson(settingsFile(sb));
      expect(Object.keys(doc).sort()).toEqual(["modelRoles", "subagents", "taskflow"]);
    } finally {
      sb.cleanup();
    }
  });

  test("JSON inválido → MergeError apontando o arquivo, nada modificado (SETM-04)", async () => {
    const sb = makeSandbox();
    try {
      writeRaw(sb, "{ nope");
      expect(() => applyMerge(fullTargets("global"), rt(sb))).toThrow(MergeError);
      try {
        applyMerge(fullTargets("global"), rt(sb));
      } catch (error) {
        expect(error).toBeInstanceOf(MergeError);
        expect((error as MergeError).file).toBe(settingsFile(sb));
        expect((error as MergeError).message).toContain(settingsFile(sb));
      }
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe("{ nope");
    } finally {
      sb.cleanup();
    }
  });

  test("two-pass: alvo inválido em QUALQUER arquivo → zero escritas (SETM-04)", async () => {
    const sb = makeSandbox();
    try {
      // settings.json válido com defaults ausentes (seria escrito num pass único)
      // + pr-review.json corrompido → nenhum arquivo pode ser modificado.
      writeDoc(sb, { packages: [] });
      const prReviewFile = path.join(sb.piHome, "pr-review.json");
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(prReviewFile, "{ quebrado", "utf8");

      const before = fs.readFileSync(settingsFile(sb), "utf8");
      expect(() => applyMerge(fullTargets("global"), rt(sb))).toThrow(MergeError);
      try {
        applyMerge(fullTargets("global"), rt(sb));
      } catch (error) {
        expect((error as MergeError).file).toBe(prReviewFile); // aponta o arquivo inválido
      }
      // settings.json válido NÃO foi escrito (pass 1 valida tudo antes)
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe(before);
      const doc = readJson(settingsFile(sb));
      expect(doc.subagents).toBeUndefined();
      expect(doc.modelRoles).toBeUndefined();
      expect(fs.readFileSync(prReviewFile, "utf8")).toBe("{ quebrado");
    } finally {
      sb.cleanup();
    }
  });

  test("JSON válido mas não-objeto → aborta (fail-closed)", async () => {
    const sb = makeSandbox();
    try {
      writeRaw(sb, "[1, 2, 3]");
      expect(() => applyMerge(fullTargets("global"), rt(sb))).toThrow(MergeError);
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe("[1, 2, 3]");
    } finally {
      sb.cleanup();
    }
  });
});

describe("applyMerge — scopes (SETM edge: projeto vence global)", () => {
  test("workspace → merge no .pi/settings.json do projeto, global intocado", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(path.join(project, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(project, ".pi", "settings.json"), JSON.stringify({ packages: [] }, null, 2));
      const rtProj: Runtime = { cwd: project, env: sb.env };

      applyMerge(fullTargets("workspace"), rtProj);

      const projectDoc = readJson(path.join(project, ".pi", "settings.json"));
      expect(projectDoc.subagents).toEqual({ modelScope: { enforce: false } });
      // global não foi criado/tocado
      expect(fs.existsSync(settingsFile(sb))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });
});

describe("targets — pr-review e goal-loop-audit (AD-012 + experimento)", () => {
  test("pr-review: sem defaults v1 → arquivo próprio nunca é criado", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, { packages: [] });
      const outcome = applyMerge(fullTargets("global"), rt(sb));
      const prReviewFile = path.join(sb.piHome, "pr-review.json");
      expect(fs.existsSync(prReviewFile)).toBe(false);
      expect(outcome.filesWritten).toEqual([settingsFile(sb)]);
    } finally {
      sb.cleanup();
    }
  });

  test("goal-loop-audit: sem defaults v1 → arquivo próprio nunca é criado", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, { packages: [] });
      applyMerge(fullTargets("global"), rt(sb));
      expect(fs.existsSync(path.join(sb.piHome, "pi-goal-list-loop-audit.settings.json"))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("targetsForComponents filtra por componente", async () => {
    const targets = targetsForComponents(["subagents", "pr-review"], "global");
    expect(targets.map((t) => t.component)).toEqual(["subagents", "pr-review"]);
    const subagents = targets.find((t) => t.component === "subagents");
    expect(subagents?.prefix).toEqual(["subagents"]);
    const prReview = targets.find((t) => t.component === "pr-review");
    expect(prReview?.file).toBe("pr-review");
    expect(prReview?.defaults).toEqual([]);
  });

  test("pr-review target no workspace aponta para .pi/pr-review.json do projeto", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      const targets = targetsForComponents(["pr-review"], "workspace");
      expect(targets).toHaveLength(1);
      const rtProj: Runtime = { cwd: project, env: sb.env };
      const prReviewFile = piSettingsPath(rtProj, "workspace").replace(/settings\.json$/, "pr-review.json");
      expect(prReviewFile).toBe(path.join(project, ".pi", "pr-review.json"));
      // merge não cria o arquivo (sem defaults)
      const outcome = applyMerge(targets, rtProj);
      expect(outcome.filesWritten).toEqual([]);
      expect(fs.existsSync(prReviewFile)).toBe(false);
    } finally {
      sb.cleanup();
    }
  });
});

describe("removeSettingsChanges — uninstall limpo (SETM-05)", () => {
  const registered: SettingsChange[] = [
    { file: "/", path: ["subagents", "modelScope", "enforce"], value: false },
    { file: "/", path: ["modelRoles"], value: { ...TASKFLOW_MODEL_ROLES } },
  ];

  test("valor atual == registrado → chave removida (sem resíduo vazio)", async () => {
    const sb = makeSandbox();
    try {
      const file = settingsFile(sb);
      writeDoc(sb, {
        packages: [],
        subagents: { modelScope: { enforce: false }, defaultModel: "meu/abc" },
        modelRoles: { ...TASKFLOW_MODEL_ROLES },
      });
      const entries = registered.map((e) => ({ ...e, file }));
      const outcome = removeSettingsChanges(entries, rt(sb), "global");

      expect(outcome.removed.map((c) => c.path.join(".")).sort()).toEqual(["modelRoles", "subagents.modelScope.enforce"]);
      expect(outcome.preserved).toEqual([]);
      expect(outcome.filesWritten).toEqual([file]);

      const doc = readJson(file);
      // enforce removido; defaultModel do usuário e subagents preservados
      expect(doc.subagents).toEqual({ defaultModel: "meu/abc" });
      // modelRoles inteiro removido (top-level pruned)
      expect(doc.modelRoles).toBeUndefined();
      expect(doc.packages).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("valor editado pelo usuário → preservado e reportado (SETM 2.2)", async () => {
    const sb = makeSandbox();
    try {
      const file = settingsFile(sb);
      writeDoc(sb, {
        subagents: { modelScope: { enforce: true, allow: ["*"] } },
        modelRoles: { ...TASKFLOW_MODEL_ROLES, builder: "outro/modelo" },
      });
      const entries = registered.map((e) => ({ ...e, file }));
      const outcome = removeSettingsChanges(entries, rt(sb), "global");

      expect(outcome.removed).toEqual([]);
      expect(outcome.preserved.map((c) => c.path.join(".")).sort()).toEqual(["modelRoles", "subagents.modelScope.enforce"]);
      // preservado carrega o valor ATUAL (leaf) da chave editada pelo usuário
      expect(outcome.preserved.find((c) => c.path.join(".") === "subagents.modelScope.enforce")?.value).toBe(true);
      expect(outcome.filesWritten).toEqual([]);
      // arquivo intacto
      const doc = readJson(file);
      expect((doc.subagents as { modelScope: { enforce: boolean } }).modelScope.enforce).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("chave já ausente → ignorada em silêncio", async () => {
    const sb = makeSandbox();
    try {
      writeDoc(sb, { packages: [] });
      const file = settingsFile(sb);
      const outcome = removeSettingsChanges(registered.map((e) => ({ ...e, file })), rt(sb), "global");
      expect(outcome.removed).toEqual([]);
      expect(outcome.preserved).toEqual([]);
      expect(outcome.filesWritten).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("JSON inválido no arquivo → preserva tudo, não destrói nada (conservador)", async () => {
    const sb = makeSandbox();
    try {
      const file = settingsFile(sb);
      writeRaw(sb, "{ quebrado");
      const outcome = removeSettingsChanges(registered.map((e) => ({ ...e, file })), rt(sb), "global");
      expect(outcome.removed).toEqual([]);
      expect(outcome.preserved).toHaveLength(2);
      expect(fs.readFileSync(file, "utf8")).toBe("{ quebrado");
    } finally {
      sb.cleanup();
    }
  });
});

describe("atribuição por componente (uninstall --component)", () => {
  test("settingsChange de subagents/taskflow/modelRoles atribuídos ao dono", async () => {
    const sb = makeSandbox();
    try {
      const file = settingsFile(sb);
      const cases: Array<[string[], string]> = [
        [["subagents", "modelScope", "enforce"], "subagents"],
        [["taskflow", "piChild", "resourceProfile"], "taskflow"],
        [["modelRoles"], "taskflow"],
      ];
      for (const [p, expected] of cases) {
        expect(componentForSettingsChange({ file, path: p }, rt(sb), "global")).toBe(expected);
      }
      // chave não gerenciada → null
      expect(componentForSettingsChange({ file, path: ["subagents", "defaultModel"] }, rt(sb), "global")).toBeNull();
      expect(componentForSettingsChange({ file, path: ["outroPackage"] }, rt(sb), "global")).toBeNull();
    } finally {
      sb.cleanup();
    }
  });

  test("path parcial sob managed path (leaves do deep merge) atribuído ao dono", async () => {
    const sb = makeSandbox();
    try {
      const file = settingsFile(sb);
      // deep merge registra leaves abaixo do managed path: modelRoles parcial
      // do usuário → created em ["modelRoles","steward"] etc. (len 2) — dono taskflow
      for (const p of [["modelRoles", "steward"], ["modelRoles", "builder"], ["modelRoles", "scout"], ["modelRoles", "expert"]]) {
        expect(componentForSettingsChange({ file, path: p }, rt(sb), "global")).toBe("taskflow");
      }
      // qualquer path sob modelRoles é do taskflow (prefixo gerenciado)
      expect(componentForSettingsChange({ file, path: ["modelRoles", "outro"] }, rt(sb), "global")).toBe("taskflow");
      // container parcial que o merge v1 nunca registra → null
      expect(componentForSettingsChange({ file, path: ["subagents", "modelScope"] }, rt(sb), "global")).toBeNull();
      expect(componentForSettingsChange({ file, path: ["modelRoles"] }, rt(sb), "global")).toBe("taskflow");
    } finally {
      sb.cleanup();
    }
  });
});
