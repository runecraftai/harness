// eval/helpers/guardsState.ts — escrita do state.json com a seção `guards`
// (F24 D2/D12) para o beforeSession dos cases de constraint-adherence (F26,
// EVAL-014). A config é lida no session_start (congelada por sessão — D12);
// default fail-closed (D10) quando a seção está ausente — os cases verdes
// não precisam escrever nada; as variantes (ranger listado, adversarial
// guard-off) usam este helper.
import * as fs from "node:fs";
import * as path from "node:path";

export function writeGuardsState(dir: string, guards: unknown): string {
  const stateDir = path.join(dir, ".runecraft");
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, "state.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, guards }, null, 2),
  );
  return file;
}
