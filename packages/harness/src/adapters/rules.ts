// adapters/rules.ts — rules-file sections for non-Pi agents (F15 D3, G1).
//
// Thin HTML-family wrapper over the section engine (F18 sections.ts): rules
// files (CLAUDE.md / AGENTS.md) are text files, so the marker family is
// `html` (`<!-- runecraft:<section> -->`). Executable targets (F20 git hooks)
// use the `shell` family directly via sections.ts. This module keeps the F15
// public API so adapters/doctor/sync are untouched.
export {
  detectEol,
  hasUtf8Bom,
  isValidUtf8,
  NonUtf8FileError,
  type SectionUpsertResult as UpsertResult,
} from "../sections.ts";
import {
  hasSectionFamily,
  listSectionIds,
  markersFor,
  readSectionContentFamily,
  removeSectionFamily,
  upsertSectionFamily,
  type SectionFamily,
} from "../sections.ts";

export const RULES_SECTION = "runecraft:workflow";
const FAMILY: SectionFamily = "html";

export function sectionMarkers(section: string): { open: string; close: string } {
  return markersFor(FAMILY, section);
}

/**
 * Upsert a `runecraft:<section>` block into `file` (HTML markers).
 * See sections.ts upsertSectionFamily for the full contract.
 */
export function upsertSection(file: string, section: string, content: string): import("../sections.ts").SectionUpsertResult {
  return upsertSectionFamily(file, section, content, FAMILY);
}

/**
 * Remove the `runecraft:<section>` block. See sections.ts removeSectionFamily.
 */
export function removeSection(file: string, section: string): string | null {
  return removeSectionFamily(file, section, FAMILY);
}

/** Read-only presence check (F17 D3 check 9). */
export function hasSection(file: string, section: string): boolean {
  return hasSectionFamily(file, section, FAMILY);
}

/** Read the body of the `runecraft:<section>` block (F19 D7 three-way sync). */
export function readSectionContent(file: string, section: string): string | null {
  return readSectionContentFamily(file, section, FAMILY);
}

/** Ids of complete `runecraft:` blocks in the file (F18 uninstall — preserved
 *  markers without a state registration are reported, never removed). */
export function listRulesSectionIds(file: string): string[] {
  return listSectionIds(file, FAMILY, "runecraft:");
}
