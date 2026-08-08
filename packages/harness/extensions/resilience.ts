// extensions/resilience.ts — camada de resiliência & continuidade como
// extensão Pi do harness (F27, D1–D6).
//
// Materializada APENAS em sessões gerenciadas pelo harness (agentDir temp com
// settings.json `extensions` — mecanismo H1/F6, validado no F21): a manifest
// do package (pi.extensions) e o fixture de teste apontam para este arquivo.
// A extensão registra o wiring (installResilience) e nada mais — a decisão
// vive nos módulos puros de src/resilience/.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installResilience } from "../src/extensions/resilience.ts";

export default function registerResilience(pi: ExtensionAPI): void {
  installResilience(pi);
}
