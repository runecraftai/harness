// resilience/index.ts — exports públicos do F27 (Resilience & Continuity).
//
// Superfície: tipos, config (thresholds/kill switch), continuation builder,
// todo preserver, stall detector, classificador e fallback engine. O wiring
// Pi vive em src/extensions/resilience.ts (installResilience — bindExtensions).
export * from "./types.ts";
export * from "./config.ts";
export * from "./continuation.ts";
export * from "./todo-preserver.ts";
export * from "./stall.ts";
export * from "./classify.ts";
export * from "./fallback.ts";
