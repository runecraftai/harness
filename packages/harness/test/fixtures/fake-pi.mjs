#!/usr/bin/env node
// fake-pi.mjs — deterministic fake of the `pi` binary for F11/F21 tests.
//
// Mirrors the surface the harness uses (packages.md of pi-coding-agent):
//   fake-pi --version
//   fake-pi install [-l] <spec>      (identity dedup = npm name without version)
//   fake-pi remove [-l] <spec>
//   fake-pi list                     (User packages + Project packages sections)
//
// State lives in the same settings.json files the harness reads, keyed by the
// same env overrides:
//   RUNECRAFT_PI_HOME  → global settings dir (~/.pi/agent in prod)
//   cwd/.pi/settings.json            → project settings (when -l is passed)
// Behavior knobs:
//   FAKE_PI_FAIL=<substring>   → `install` of a spec containing it exits 1
//   FAKE_PI_VERSION=<x.y.z>    → `--version` output (default 0.84.0)
//   FAKE_PI_LIST_FAIL=1        → `list` exits 1 (simulates a corrupt pi binary)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);

function globalSettingsPath() {
  return path.join(process.env.RUNECRAFT_PI_HOME ?? path.join(os.homedir(), ".pi", "agent"), "settings.json");
}

function localSettingsPath() {
  return path.join(process.cwd(), ".pi", "settings.json");
}

function readPackages(file) {
  if (!fs.existsSync(file)) return [];
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(settings.packages) ? settings.packages.filter((p) => typeof p === "string") : [];
}

function writePackages(file, packages) {
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  settings.packages = packages;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

function isLocal() {
  return args.includes("-l") || args.includes("--local");
}

function command() {
  return args.find((a) => !a.startsWith("-"));
}

function specArg() {
  const cmdIndex = args.indexOf("install") !== -1 ? args.indexOf("install") : args.indexOf("remove");
  if (cmdIndex === -1) return undefined;
  return args.slice(cmdIndex + 1).find((a) => !a.startsWith("-"));
}

// npm identity = package name without the version pin (matches pi packages.md).
function identity(spec) {
  const m = /^npm:(@?[^@]+)(@|$)/.exec(spec);
  return m ? `npm:${m[1]}` : spec;
}

const cmd = command();

if (args.includes("--version") || args.includes("version") || cmd === "--version" || cmd === "version") {
  process.stdout.write(`${process.env.FAKE_PI_VERSION ?? "0.84.0"}\n`);
} else if (cmd === "install" || cmd === "remove") {
  const spec = specArg();
  if (!spec) {
    process.stderr.write(`fake-pi: ${cmd} precisa de um spec\n`);
    process.exit(2);
  }
  const file = isLocal() ? localSettingsPath() : globalSettingsPath();
  const packages = readPackages(file);
  const id = identity(spec);
  if (cmd === "install") {
    const failPattern = process.env.FAKE_PI_FAIL;
    if (failPattern && spec.includes(failPattern)) {
      process.stderr.write(`fake-pi: install falhou para ${spec} (FAKE_PI_FAIL=${failPattern})\n`);
      process.exit(1);
    }
    if (!packages.includes(id)) {
      packages.push(id);
      writePackages(file, packages);
    }
    process.stdout.write(`installed ${id}\n`);
  } else {
    const filtered = packages.filter((p) => p !== id);
    if (filtered.length !== packages.length) writePackages(file, filtered);
    process.stdout.write(`removed ${id}\n`);
  }
} else if (cmd === "list") {
  if (process.env.FAKE_PI_LIST_FAIL) {
    process.stderr.write("fake-pi: list falhou (FAKE_PI_LIST_FAIL)\n");
    process.exit(1);
  }
  const globalPackages = readPackages(globalSettingsPath());
  const localPackages = readPackages(localSettingsPath());
  process.stdout.write("User packages:\n");
  for (const p of globalPackages) process.stdout.write(`  ${p}\n    /fake/global/${p}\n`);
  process.stdout.write("Project packages:\n");
  for (const p of localPackages) process.stdout.write(`  ${p}\n    /fake/project/${p}\n`);
} else {
  process.stderr.write(`fake-pi: comando desconhecido: ${cmd ?? "(nenhum)"}\n`);
  process.exit(2);
}
