// observability/lessons-types.ts — tipos do domínio de lessons (D5, OBS-06/07).
//
// Módulo-folha: tipos compartilhados entre types.ts (eventos lesson:*) e
// lessons.ts (estado/promoção/adendo) sem ciclo de imports. Zero deps.
export type LessonPriority = "low" | "med" | "high";
export type LessonTrack = "planning" | "execution";
export type LessonStatus = "active" | "promoted" | "archived";

/** As 4 partes da lição (pilar 7): gatilho, anti-padrão, padrão preferido, prioridade. */
export interface Lesson {
  trigger: string;
  antiPattern: string;
  preferred: string;
  priority: LessonPriority;
  /** guardId | layer do veredito | sinal (D5) — filtro do adendo (D6). */
  gate: string;
  track: LessonTrack;
}

/** Record persistido em lessons.jsonl (ESTADO — D5; reincidência reescreve). */
export interface LessonRecord extends Lesson {
  /** determinístico: sha256(canonicalJson({trigger, gate})).slice(0, 16). */
  lessonId: string;
  /** sha256 canônico de {trigger, gate} (dedupe — D5). */
  triggerSignature: string;
  count: number;
  status: LessonStatus;
  firstSeenSeq: number;
  lastSeenSeq: number;
}

/** Resultado da transição de captura (pura — D5). */
export type CaptureOutcome = "captured" | "reincidence";
