// eval-e2e/lib/wait.ts — polling determinístico p/ evidência (ledger/fs).
import { setTimeout as sleep } from "node:timers/promises";

export interface WaitOptions {
	timeoutMs: number;
	intervalMs?: number;
	label: string;
}

/** Espera a condição virar true (polling); false no timeout. Nunca lança. */
export async function waitForCondition(pred: () => boolean, opts: WaitOptions): Promise<boolean> {
	const interval = opts.intervalMs ?? 2_000;
	const deadline = Date.now() + opts.timeoutMs;
	while (Date.now() < deadline) {
		try {
			if (pred()) return true;
		} catch {
			// predicado lançou (fs ausente etc.) — continua esperando
		}
		await sleep(interval);
	}
	return false;
}
