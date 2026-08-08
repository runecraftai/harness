// smoke-memory-node.mjs — verificação MANUAL do driver node:sqlite (F35, SQL-05).
//
// O runtime de produção do pi é node; a memória (F29) cai no fallback
// node:sqlite (DatabaseSync). Este script exercita a superfície EXATA usada
// pelo harness (exec + prepare().get/all/run + FTS5 MATCH + pragmas) fora do
// bun, onde node:sqlite não existe.
//
// Uso:  node scripts/smoke-memory-node.mjs
// (node >= 22.19; FTS5 verificado em node v26.5.0; não wire em CI.)
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("CREATE VIRTUAL TABLE memories USING fts5(body)");
db.prepare("INSERT INTO memories(body) VALUES (?)").run("hello runes");
const row = db.prepare("SELECT count(*) AS c FROM memories WHERE memories MATCH ?").get("hello");
if (row.c !== 1) {
	throw new Error(`FTS5 MATCH devolveu ${row.c} rows (esperado 1)`);
}
const all = db.prepare("SELECT body FROM memories").all();
if (all.length !== 1 || all[0].body !== "hello runes") {
	throw new Error("SELECT all() inesperado");
}
db.close();
console.log("smoke-memory-node: OK (node:sqlite + WAL/FK/busy_timeout + FTS5 + prepare().run/get/all).");
