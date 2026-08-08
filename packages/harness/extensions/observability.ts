// extensions/observability.ts — camada de observabilidade & lessons como
// extensão Pi do harness (F28, D1–D10).
//
// Materializada APENAS em sessões gerenciadas pelo harness (agentDir temp com
// settings.json `extensions` — mecanismo H1/F6, validado no F21): a manifest
// do package (pi.extensions) e o fixture de teste apontam para este arquivo.
// A extensão registra o wiring (installObservability) e nada mais — a decisão
// vive nos módulos de src/observability/ (store/bundle/recorder/monitor/
// lessons/export).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installObservability } from "../src/extensions/observability.ts";

export default function registerObservability(pi: ExtensionAPI): void {
  installObservability(pi);
}
