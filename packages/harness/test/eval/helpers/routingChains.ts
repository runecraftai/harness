// eval/helpers/routingChains.ts — helper dos cases de routing (F33, T7).
//
// Materializa as pilot chains em <repoDir>/.pi/chains/ ANTES da sessão do
// fixture abrir (beforeSession) — o roteador codificado verifica a presença
// da chain no .pi/chains/ (chain ausente → fail-closed direct + warn —
// EVAL-078 cobre esse caminho). Reusa o materialize three-way do F33
// (mesma fonte dos assets — byte-idêntico por construção).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  applyPilotChains,
  planPilotChains,
  pilotChainsDir,
  readPilotChainAsset,
  packageRoot,
  type PilotChainName,
  type PilotChainRecord,
} from "../../../src/routing/materialize.ts";

/** Materializa as chains dadas (nomes sem extensão) em <repoDir>/.pi/chains/. */
export function materializePilotChains(repoDir: string, names: PilotChainName[]): void {
  const piChains: Record<string, PilotChainRecord> = {};
  const plans = planPilotChains(repoDir, piChains).filter((p) => names.includes(p.name));
  applyPilotChains(repoDir, piChains, plans);
  const dir = pilotChainsDir(repoDir);
  for (const name of names) {
    const asset = readPilotChainAsset(name, packageRoot());
    if (asset === null) throw new Error(`asset ${name}.chain.md ausente do pacote`);
    if (!existsSync(`${dir}/${name}.chain.md`)) {
      // Defensivo: o apply só escreve missing/updated; garante a presença.
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${name}.chain.md`, asset, "utf8");
    }
  }
}

/** Cria um spec SDD fake em .specs/features/<slug>/spec.md (EVAL-074). */
export function writeSpecFile(repoDir: string, slug = "f1"): string {
  const file = `${repoDir}/.specs/features/${slug}/spec.md`;
  mkdirSync(`${repoDir}/.specs/features/${slug}`, { recursive: true });
  writeFileSync(file, "# Spec f1\n", "utf8");
  return file;
}
