// plan.ts — presets + components → install plan (F11).
//
// Versions come from src/versions.ts, generated from vendor.manifest.json
// (single source of truth). The CLI never hardcodes versions here.
import { HARNESS_VERSIONS } from "./versions.ts";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type PresetName = "minimal" | "full";

export const PRESETS: readonly PresetName[] = ["minimal", "full"];

export interface ComponentDef {
  name: string;
  description: string;
  /** @runecraft/* package names that make up the component. */
  packages: string[];
}

/** Components exposed by the CLI (--component). */
export const COMPONENTS: Record<string, ComponentDef> = {
  subagents: {
    name: "subagents",
    description: "Dispatch de subagentes (subagent(...))",
    packages: ["@runecraft/subagents"],
  },
  taskflow: {
    name: "taskflow",
    description: "DAG de tarefas /tf — core + pi + dsl (3 packages)",
    packages: ["@runecraft/taskflow-core", "@runecraft/taskflow", "@runecraft/taskflow-dsl"],
  },
  "goal-loop-audit": {
    name: "goal-loop-audit",
    description: "Goal loop com auditor isolado (/goal)",
    packages: ["@runecraft/goal-loop-audit"],
  },
  "pr-review": {
    name: "pr-review",
    description: "Code review de PRs (/pr-review)",
    packages: ["@runecraft/pr-review"],
  },
};

export const COMPONENT_NAMES: readonly string[] = Object.keys(COMPONENTS);

/**
 * Preset → components.
 * `full` = minimal + defaults de settings via merge (F14). O merge engine
 * aplica por overlay: chave do usuário vence, conflito reportado, adições
 * registradas em settingsChanges (removíveis no uninstall).
 */
export const PRESET_COMPONENTS: Record<PresetName, readonly string[]> = {
  minimal: ["subagents", "taskflow", "goal-loop-audit", "pr-review"],
  full: ["subagents", "taskflow", "goal-loop-audit", "pr-review"],
};

export const DEFAULT_PRESET: PresetName = "minimal";

/**
 * Upstream package names that collide with the runecraft forks (CLI-09).
 * Matched against the bare npm name (after `npm:`) or its last path segment,
 * so scoped variants like @tintinweb/pi-subagents are caught too. The harness
 * only warns and suggests removal — it never removes anything (full handling
 * in F18).
 */
export const UPSTREAM_PACKAGES: readonly string[] = [
  "pi-subagents",
  "pi-taskflow",
  "pi-goal-list-loop-audit",
  "pi-pr-review",
  "gentle-pi",
];

export interface PlanEntry {
  /** package name, e.g. @runecraft/taskflow-core */
  name: string;
  /** logical component group, e.g. taskflow */
  group: string;
  /** npm spec without version, e.g. npm:@runecraft/taskflow-core */
  source: string;
  version: string;
}

export interface InstallPlan {
  preset: PresetName;
  components: string[];
  entries: PlanEntry[];
  /** full pinned specs passed to pi install, e.g. npm:@runecraft/subagents@0.37.2 */
  specs: string[];
}

export function specForPackage(name: string): string {
  const version = HARNESS_VERSIONS[name];
  if (!version) {
    throw new Error(
      `versão ausente para ${name} em src/versions.ts — rode \`bun run generate:versions\` (fonte: vendor.manifest.json)`,
    );
  }
  return `npm:${name}@${version}`;
}

/** Validates a --component list; returns the valid names or the invalid ones. */
export function validateComponents(selected: string[]): { ok: string[]; invalid: string[] } {
  const ok: string[] = [];
  const invalid: string[] = [];
  for (const raw of selected) {
    for (const name of raw.split(",")) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      if (COMPONENTS[trimmed]) ok.push(trimmed);
      else invalid.push(trimmed);
    }
  }
  return { ok, invalid };
}

export function isPreset(value: string | undefined): value is PresetName {
  return value === "minimal" || value === "full";
}

export function buildPlan(preset: PresetName, selectedComponents: string[] | undefined): InstallPlan {
  const componentNames =
    selectedComponents !== undefined && selectedComponents.length > 0
      ? selectedComponents
      : [...PRESET_COMPONENTS[preset]];
  const entries: PlanEntry[] = [];
  for (const componentName of componentNames) {
    const def = COMPONENTS[componentName];
    if (!def) {
      throw new Error(`component desconhecido: ${componentName} (esperado: ${COMPONENT_NAMES.join(", ")})`);
    }
    for (const pkg of def.packages) {
      const version = HARNESS_VERSIONS[pkg];
      if (!version) throw new Error(`versão ausente para ${pkg} em src/versions.ts`);
      entries.push({
        name: pkg,
        group: componentName,
        source: `npm:${pkg}`,
        version,
      });
    }
  }
  return {
    preset,
    components: componentNames,
    entries,
    specs: entries.map((e) => `${e.source}@${e.version}`),
  };
}

/** Help text (CLI-06): documents commands, flags, components and presets. */
export function helpText(): string {
  const componentLines = COMPONENT_NAMES.map((name) => {
    const def = COMPONENTS[name];
    if (!def) return `  ${name} (?component desconhecido?)`;
    return `  ${name.padEnd(16)} ${def.description} (${def.packages.map((p) => `npm:${p}@${HARNESS_VERSIONS[p] ?? "?"}`).join(", ")})`;
  });
  return [
    "@runecraft/harness — CLI do harness. Orquestra `pi install` para os components runecraft.",
    "",
    "Uso:",
    "  npx @runecraft/harness <comando> [flags]",
    "",
    "Comandos:",
    "  install        Instala os components selecionados via `pi install` (default: preset minimal)",
    "  doctor         Diagnóstico read-only: 6 checks pass/warn/fail com remedy (F12)",
    "  status         Estado cruzado (pi list × state × manifest) em tabela — 6 packages (F12)",
    "  sync           Reconciliação idempotente: reinstala o que o harness gerenciou e sumiu (F12)",
    "  uninstall      Remoção gerenciada — remove SÓ o que o harness instalou (--component/--all, F12)",
    "  restore <nome> Restaura os arquivos de um snapshot para os paths originais (F13)",
    "  backups        Lista snapshots (data, tamanho, arquivos, pinado) — F13",
    "  gates          Delivery gates (F20): enable | disable | status | run pre-commit|pre-push",
    "  receipt        Receipt leve (F20): capture <pr> [--from <file>] [--include-closed] | list [--json]",
    "  verify         Cascata de verificação (F25): MESMA engine do gate de sessão — exit 0/1/2/3, --json, --cwd",
    "",
    "Flags:",
    "  --component <a,b>  Components (install/uninstall); repita a flag ou separe por vírgula",
    "  --preset <nome>    minimal | full (default: minimal)",
    "  --dry-run          Mostra o plano sem aplicar nenhuma mudança (install, sync, gates)",
    "  --json             Saída JSON para CI (installed/kept/conflicts/failed | checks | packages | gates/receipt)",
    "  --scope <escopo>   global | workspace (default: global; status/sync/uninstall usam workspace se houver state.json no projeto; gates disable default global — kill switch)",
    "  --all              uninstall: remove tudo que o harness gerenciou",
    "  --keep <nome>      backups: pina um snapshot (nunca é removido pelo prune de 5)",
    "  --from <arquivo>   receipt capture: review JSON já produzido (fluxo manual, zero re-review)",
    "  --include-closed   receipt capture: permitir PR fechado (--include-closed no /pr-review)",
    "  --yes              Confirma sem perguntar (em não-TTY auto-aceita)",
    "  -h, --help         Esta ajuda",
    "  -v, --version      Versão do package",
    "",
    "Components:",
    ...componentLines,
    "",
    "Presets:",
    "  minimal  → todos os 4 components (6 packages), sem tocar settings de configuração",
    "  full     → minimal + defaults de settings aplicados por merge (F14):",
    "             subagents.modelScope.enforce=false · taskflow.piChild.resourceProfile=isolated",
    "             · modelRoles (steward/expert/builder/scout) — usuário sempre vence,",
    "             conflito reportado, nunca sobrescrito; adições registradas e removíveis no uninstall",
    "",
    "Exemplos:",
    "  npx @runecraft/harness install",
    "  npx @runecraft/harness doctor --json",
    "  npx @runecraft/harness status --scope workspace",
    "  npx @runecraft/harness sync --dry-run",
    "  npx @runecraft/harness uninstall --component goal-loop-audit",
    "  npx @runecraft/harness uninstall --all --yes",
    "  npx @runecraft/harness backups",
    "  npx @runecraft/harness restore runecraft-20260805-120000-000.tar.gz",
    "  npx @runecraft/harness gates enable",
    "  npx @runecraft/harness gates status",
    "  npx @runecraft/harness gates run pre-commit   (hook shim — debug)",
    "  npx @runecraft/harness receipt capture 123 --include-closed",
    "  npx @runecraft/harness receipt capture 123 --from review.json",
    "  npx @runecraft/harness receipt list --json",
    "",
  ].join("\n");
}

export function versionText(): string {
  const pkg = require("../package.json") as { version?: string };
  return `@runecraft/harness ${pkg.version ?? "0.0.0"}\n`;
}
