// agents/prompt-loader.ts — loader de arquivos de prompt (F32, D4; ROLE-04).
//
// Port fiel do `loadPromptFile` do arcanum (src/agents/prompt-loader.ts —
// lido no Execute F32): carrega um arquivo de prompt com sandbox de basePath.
// Regras do source preservadas:
//   - caminho absoluto → null (nunca lê fora do controle do harness)
//   - traversal (`..`) que sai do basePath → null
//   - extensão fora de {.md, .txt} → null
//   - arquivo ausente/ilegível → null (fail-soft — prompt opcional)
//   - conteúdo com trim (sem \n de borda)
//
// Módulo PURO por construção (sem estado, sem relógio — F21 D10): mesmo
// input → mesmo resultado.
import * as fs from "node:fs";
import * as path from "node:path";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt"]);

/** True quando `resolved` está dentro de `baseDir` (ou é o próprio baseDir). */
export function isWithinBase(resolved: string, baseDir: string): boolean {
  const rel = path.relative(baseDir, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Carrega um arquivo de prompt com sandbox (port do arcanum).
 * `promptFilePath` relativo a `basePath` (default: cwd do processo);
 * null para absoluto, traversal fora da base, extensão não permitida ou
 * arquivo ausente. Conteúdo com trim.
 */
export function loadPromptFile(promptFilePath: string, basePath?: string): string | null {
  const base = basePath ?? process.cwd();
  if (path.isAbsolute(promptFilePath)) return null;
  const extension = path.extname(promptFilePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;

  const resolved = path.resolve(base, promptFilePath);
  if (!isWithinBase(resolved, path.resolve(base))) return null;

  try {
    const content = fs.readFileSync(resolved, "utf8");
    return content.trim();
  } catch {
    return null;
  }
}
