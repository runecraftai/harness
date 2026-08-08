// test/memory/validate.test.ts — T2 (D3): validação manual com MESMOS códigos
// do source (INVALID_CATEGORY, EMPTY_TITLE, TITLE_TOO_LONG, EMPTY_WHAT,
// WHAT_TOO_LONG, INVALID_TITLE, INVALID_WHAT).
import { describe, expect, test } from "bun:test";
import {
	clampImportance,
	validateSave,
	validateUpdate,
	ValidationError,
} from "../../src/memory/validate.ts";

function codeOf(fn: () => void): string {
	try {
		fn();
	} catch (err) {
		if (err instanceof ValidationError) return err.code;
		throw err;
	}
	throw new Error("esperava ValidationError");
}

describe("validateSave (códigos do source)", () => {
	test("categoria inválida → INVALID_CATEGORY", () => {
		expect(codeOf(() => validateSave({ category: "bogus", title: "t", what: "w" }))).toBe("INVALID_CATEGORY");
		expect(codeOf(() => validateSave({ category: 42, title: "t", what: "w" }))).toBe("INVALID_CATEGORY");
	});

	test("título vazio → EMPTY_TITLE; longo → TITLE_TOO_LONG", () => {
		expect(codeOf(() => validateSave({ category: "decisions", title: "", what: "w" }))).toBe("EMPTY_TITLE");
		expect(codeOf(() => validateSave({ category: "decisions", title: "   ", what: "w" }))).toBe("EMPTY_TITLE");
		expect(codeOf(() => validateSave({ category: "decisions", title: "x".repeat(201), what: "w" }))).toBe("TITLE_TOO_LONG");
	});

	test("what vazio → EMPTY_WHAT; longo → WHAT_TOO_LONG", () => {
		expect(codeOf(() => validateSave({ category: "decisions", title: "t", what: "" }))).toBe("EMPTY_WHAT");
		expect(codeOf(() => validateSave({ category: "decisions", title: "t", what: "x".repeat(4001) }))).toBe("WHAT_TOO_LONG");
	});

	test("importância não-inteira → INVALID_IMPORTANCE", () => {
		expect(codeOf(() => validateSave({ category: "decisions", title: "t", what: "w", importance: 3.5 }))).toBe("INVALID_IMPORTANCE");
	});

	test("válido → sem throw", () => {
		expect(() => validateSave({ category: "learnings", title: "t", what: "w", importance: 7 })).not.toThrow();
	});
});

describe("validateUpdate", () => {
	test("título inválido → INVALID_TITLE; what inválido → INVALID_WHAT", () => {
		expect(codeOf(() => validateUpdate({ title: "" }))).toBe("INVALID_TITLE");
		expect(codeOf(() => validateUpdate({ title: "x".repeat(201) }))).toBe("INVALID_TITLE");
		expect(codeOf(() => validateUpdate({ what: "" }))).toBe("INVALID_WHAT");
		expect(codeOf(() => validateUpdate({ what: "x".repeat(4001) }))).toBe("INVALID_WHAT");
	});

	test("campos ausentes → ok", () => {
		expect(() => validateUpdate({})).not.toThrow();
		expect(() => validateUpdate({ title: "ok" })).not.toThrow();
	});
});

describe("clampImportance", () => {
	test("clamp [1,10]; default 5 para não-número/NaN", () => {
		expect(clampImportance(undefined)).toBe(5);
		expect(clampImportance(0)).toBe(1);
		expect(clampImportance(11)).toBe(10);
		expect(clampImportance(3.9)).toBe(3);
		expect(clampImportance(Number.NaN)).toBe(5);
	});
});
