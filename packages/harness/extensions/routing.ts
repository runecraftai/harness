// extensions/routing.ts — camada de roteamento codificado do Pi (F33, D1)
// como extensão Pi do harness.
//
// Materializada APENAS em sessões gerenciadas pelo harness (agentDir temp com
// settings.json `extensions` — mecanismo H1/F6, validado no F21): a manifest
// do package (pi.extensions) e o fixture de teste apontam para este arquivo.
// A extensão registra o wiring (installRouting) e nada mais — a decisão vive
// nos módulos puros de src/routing/.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installRouting } from "../src/extensions/routing.ts";

export default function registerRouting(pi: ExtensionAPI): void {
	installRouting(pi);
}
