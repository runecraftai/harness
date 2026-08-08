// observability/bundle.test.ts — harness bundles (T2, D3, OBS-02).
//
// Fingerprint canônico: mesma config+prompts+routing → MESMO hash (2 runs);
// mudança em qualquer entrada → hash diferente; gitHead FORA do hash;
// chaves desordenadas no input → mesmo hash (canonical — padrão sort F23);
// prefixo curto estável (12 hex).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bundleShortOf, canonicalJson, collectBundleInput, computeBundleHash } from "../../src/observability/bundle.ts";
import type { BundleFingerprintInput } from "../../src/observability/types.ts";

const BASE: BundleFingerprintInput = {
  harnessVersion: "0.1.0",
  sdkVersion: "0.81.0",
  forks: { "@runecraft/subagents": "0.37.2", "@runecraft/goal-loop-audit": "0.28.34" },
  config: {
    guards: { writeExistingFile: { enabled: true } },
    verification: { enabled: true },
    resilience: { enabled: true },
    observability: { enabled: true, contextWindow: { warningPct: 0.8, criticalPct: 0.95 } },
  },
  settings: { subagents: { modelScope: { enforce: false } }, taskflow: { piChild: { resourceProfile: "isolated" } } },
  rules: "Workflow rules — stable text",
  routingVersion: "1",
};

describe("bundle — canonical hash estável (D3)", () => {
  test("mesma config+prompts → mesmo hash (2 runs); chaves desordenadas → mesmo hash", () => {
    const first = computeBundleHash(BASE);
    const second = computeBundleHash(BASE);
    expect(first).toEqual(second);
    expect(first.full).toMatch(/^[0-9a-f]{64}$/);
    expect(first.short).toMatch(/^[0-9a-f]{12}$/);
    // Chaves desordenadas no input → MESMO hash (canonical JSON, sort F23).
    const shuffled: BundleFingerprintInput = {
      routingVersion: BASE.routingVersion,
      rules: BASE.rules,
      settings: BASE.settings,
      config: BASE.config,
      forks: BASE.forks,
      sdkVersion: BASE.sdkVersion,
      harnessVersion: BASE.harnessVersion,
    };
    expect(computeBundleHash(shuffled)).toEqual(first);
    // canonicalJson recursivo: objetos aninhados também com chaves ordenadas.
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  test("mudança em config → hash DIFERENTE", () => {
    const changed = computeBundleHash({ ...BASE, config: { ...BASE.config, observability: { enabled: false } } });
    expect(changed.full).not.toBe(computeBundleHash(BASE).full);
  });

  test("mudança em settings → hash DIFERENTE", () => {
    const changed = computeBundleHash({ ...BASE, settings: { ...BASE.settings, subagents: { modelScope: { enforce: true } } } });
    expect(changed.full).not.toBe(computeBundleHash(BASE).full);
  });

  test("mudança em rules (renderRules) → hash DIFERENTE", () => {
    const changed = computeBundleHash({ ...BASE, rules: "different rules text" });
    expect(changed.full).not.toBe(computeBundleHash(BASE).full);
  });

  test("mudança em routingVersion → hash DIFERENTE", () => {
    const changed = computeBundleHash({ ...BASE, routingVersion: "2" });
    expect(changed.full).not.toBe(computeBundleHash(BASE).full);
  });

  test("gitHead FORA do hash (QA-2a): o bundle não contém gitHead", () => {
    const hash = computeBundleHash(BASE);
    expect(canonicalJson(BASE)).not.toContain("gitHead");
    expect(canonicalJson(BASE)).not.toContain("git");
    // O prefixo curto é estável (48 bits — D3).
    expect(bundleShortOf(hash.full)).toBe(hash.short);
    expect(hash.short).toHaveLength(12);
  });
});

describe("bundle — coleta do input canônico (D3)", () => {
  test("collectBundleInput lê state+settings+rules; overrides substituem (determinismo)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-bundle-"));
    try {
      fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".runecraft", "state.json"),
        JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, guards: { writeExistingFile: { enabled: true } } }),
      );
      fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".pi", "settings.json"), JSON.stringify({ subagents: { modelScope: { enforce: false } } }));
      const env = { ...process.env, RUNECRAFT_HOME: path.join(dir, "global-home") };
      const input = collectBundleInput(dir, env, "pi");
      expect(input.config.guards).toEqual({ writeExistingFile: { enabled: true } });
      expect(input.settings.subagents).toEqual({ modelScope: { enforce: false } });
      expect(typeof input.rules).toBe("string");
      expect(input.routingVersion).toBe("1");
      expect(input.harnessVersion.length).toBeGreaterThan(0);
      // Overrides: substituem sem tocar o restante.
      const overridden = collectBundleInput(dir, env, "pi", { overrides: { rules: "x" } });
      expect(overridden.rules).toBe("x");
      expect(overridden.routingVersion).toBe("1");
      // 2 coletas → mesmo input (sem gitHead no input).
      expect(collectBundleInput(dir, env, "pi")).toEqual(input);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
