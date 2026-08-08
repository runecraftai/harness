// extensions/persona.ts — camada de persona do Pi (F30, D1–D3) como
// extensão Pi do harness.
//
// Materializada APENAS em sessões gerenciadas pelo harness (agentDir temp com
// settings.json `extensions` — mecanismo H1/F6, validado no F21): a manifest
// do package (pi.extensions) e o fixture de teste apontam para este arquivo.
// A extensão registra o wiring (installPersona) e nada mais — a decisão vive
// nos módulos puros de src/persona/.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installPersona } from "../src/extensions/persona.ts";

export default function registerPersona(pi: ExtensionAPI): void {
	installPersona(pi);
}
