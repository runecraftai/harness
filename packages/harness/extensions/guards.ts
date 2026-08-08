// extensions/guards.ts — execution guards como extensão Pi do harness (F24, D8).
//
// Materializada APENAS em sessões gerenciadas pelo harness (agentDir temp com
// settings.json `extensions` — mecanismo H1/F6, validado no F21): a manifest
// do package (pi.extensions) e o fixture de teste apontam para este arquivo.
// A extensão registra os guards (installGuards — registry D1) e nada mais:
// não registra tools nem comandos (guards são política, não superfície).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installGuards } from "../src/guards/index.ts";

export default function registerGuards(pi: ExtensionAPI): void {
  installGuards(pi);
}
