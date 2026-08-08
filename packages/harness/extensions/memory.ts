// extensions/memory.ts — camada de memória persistente (F29, D1–D9) como
// extensão Pi do harness.
//
// Materializada APENAS em sessões gerenciadas pelo harness (agentDir temp com
// settings.json `extensions` — mecanismo H1/F6, validado no F21): a manifest
// do package (pi.extensions) e o fixture de teste apontam para este arquivo.
// A extensão registra o wiring (installMemory) e nada mais — a decisão vive
// nos módulos puros de src/memory/.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installMemory } from "../src/extensions/memory.ts";

export default function registerMemory(pi: ExtensionAPI): void {
  installMemory(pi);
}
