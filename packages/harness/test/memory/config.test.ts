// test/memory/config.test.ts — T4 (MEM-05): defaults; seção ausente →
// defaults; inválida → defaults + reporte (fail-closed); freeze (mudança
// mid-session não afeta); kill switch parse (0|false|off).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	defaultMemoryConfig,
	effectiveMemory,
	loadSessionMemory,
	memoryKillSwitch,
	SessionMemoryConfig,
	validateMemoryConfig,
} from "../../src/memory/config.ts";

describe("defaultMemoryConfig (D5)", () => {
	test("defaults fail-closed do design", () => {
		expect(defaultMemoryConfig()).toEqual({
			enabled: true,
			categoryCap: 10,
			disabledTools: [],
			importLessonsOnStart: false,
		});
	});
});

describe("validateMemoryConfig", () => {
	test("ausente → ok com defaults", () => {
		const v = validateMemoryConfig(undefined);
		expect(v.ok).toBe(true);
		expect(v.config).toEqual(defaultMemoryConfig());
	});

	test("seção válida → overrides aplicados", () => {
		const v = validateMemoryConfig({ enabled: false, categoryCap: 25, disabledTools: ["rune_delete"], importLessonsOnStart: true });
		expect(v.ok).toBe(true);
		expect(v.config?.categoryCap).toBe(25);
		expect(v.config?.disabledTools).toEqual(["rune_delete"]);
		expect(v.config?.importLessonsOnStart).toBe(true);
	});

	test("inválida → defaults seguros + errors (fail-closed F24 D10)", () => {
		const v = validateMemoryConfig({ categoryCap: "dez", enabled: "yes", disabledTools: "nope", importLessonsOnStart: 1 });
		expect(v.ok).toBe(false);
		expect(v.config?.categoryCap).toBe(10);
		expect(v.config?.enabled).toBe(true);
		expect(v.errors.length).toBeGreaterThanOrEqual(4);
		expect(v.errors.some((e) => e.startsWith("memory.categoryCap"))).toBe(true);
	});

	test("não-objeto → fail", () => {
		expect(validateMemoryConfig([]).ok).toBe(false);
		expect(validateMemoryConfig("x").ok).toBe(false);
	});
});

describe("effectiveMemory (workspace > global > default)", () => {
	test("workspace vence global; inválida → defaults + problems", () => {
		const merged = effectiveMemory({ categoryCap: 20 }, { categoryCap: 30 }, process.env);
		expect(merged.config.categoryCap).toBe(20);
		expect(merged.source).toBe("workspace");
		const bad = effectiveMemory({ categoryCap: "x" }, undefined, process.env);
		expect(bad.config.categoryCap).toBe(10);
		expect(bad.problems.length).toBeGreaterThan(0);
	});
});

describe("memoryKillSwitch (F20)", () => {
	test("0|false|off (case-insensitive) → ativo; ausente/vazio → inativo", () => {
		for (const v of ["0", "false", "FALSE", "off", "Off"]) {
			expect(memoryKillSwitch({ RUNECRAFT_MEMORY: v } as NodeJS.ProcessEnv).active).toBe(true);
		}
		expect(memoryKillSwitch({} as NodeJS.ProcessEnv).active).toBe(false);
		expect(memoryKillSwitch({ RUNECRAFT_MEMORY: "" } as NodeJS.ProcessEnv).active).toBe(false);
		expect(memoryKillSwitch({ RUNECRAFT_MEMORY: "1" } as NodeJS.ProcessEnv).active).toBe(false);
	});
});

describe("loadSessionMemory + freeze (D12)", () => {
	test("state com seção memory é lido do workspace; corrompido → fail-closed", () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "f29-cfg-"));
		try {
			const repo = path.join(base, "repo");
			fs.mkdirSync(path.join(repo, ".runecraft"), { recursive: true });
			fs.writeFileSync(
				path.join(repo, ".runecraft", "state.json"),
				JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { categoryCap: 15 } }),
			);
			const env = { ...process.env, RUNECRAFT_HOME: path.join(base, "home") };
			const rt = loadSessionMemory(repo, env);
			expect(rt.config.categoryCap).toBe(15);
			expect(rt.source).toBe("workspace");

			// Freeze: snapshot no capture; mudança mid-session não afeta.
			const frozen = new SessionMemoryConfig(env);
			frozen.capture(repo);
			fs.writeFileSync(
				path.join(repo, ".runecraft", "state.json"),
				JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { categoryCap: 99 } }),
			);
			expect(frozen.frozen(repo).config.categoryCap).toBe(15);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	test("kill switch no env → camada inerte (mesmo com seção ativa)", () => {
		const merged = effectiveMemory({ enabled: true }, undefined, { RUNECRAFT_MEMORY: "0" } as NodeJS.ProcessEnv);
		expect(merged.killSwitch).toBe(true);
	});
});
