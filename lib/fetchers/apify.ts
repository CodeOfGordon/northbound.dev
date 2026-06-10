/**
 * Minimal Apify REST client: start run → poll until terminal → fetch dataset items.
 * Token via Authorization header only (never ?token=, it leaks into logs).
 */

const BASE = 'https://api.apify.com/v2';
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

type ApifyRun = { id: string; status: string; statusMessage?: string; defaultDatasetId: string };

function headers(): Record<string, string> {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is not set');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export interface RunOptions {
    timeoutMs?: number;
    /**
     * HARD billing cap on dataset items (the ?maxItems= run option). An actor's
     * `maxItems` INPUT field is advisory only — the meetup actor ignored it and
     * billed 10× the requested count. Always set this for pay-per-result actors.
     */
    maxItems?: number;
    /** Pay-per-event actors charge one start fee PER GB of memory — keep this low. */
    memoryMb?: number;
}

export async function runActor(actor: string, input: unknown, opts: RunOptions = {}): Promise<unknown[]> {
    const { timeoutMs = 240_000, maxItems, memoryMb } = opts;
    const h = headers();
    // Server-side run timeout mirrors our poll deadline — an abandoned poll must not
    // leave the actor running (and billing) on Apify
    const params = new URLSearchParams({ waitForFinish: '60', timeout: String(Math.ceil(timeoutMs / 1000) + 30) });
    if (maxItems) params.set('maxItems', String(maxItems));
    if (memoryMb) params.set('memory', String(memoryMb));
    const started = await fetch(`${BASE}/acts/${actor.replace('/', '~')}/runs?${params}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(input),
    });
    if (!started.ok) {
        throw new Error(`Apify start failed for ${actor}: ${started.status} ${await started.text()}`);
    }
    let run = ((await started.json()) as { data: ApifyRun }).data;

    const deadline = Date.now() + timeoutMs;
    while (!TERMINAL.has(run.status)) {
        if (Date.now() > deadline) throw new Error(`Apify run ${run.id} (${actor}) timed out after ${timeoutMs}ms`);
        const res = await fetch(`${BASE}/actor-runs/${run.id}?waitForFinish=60`, { headers: h });
        if (!res.ok) throw new Error(`Apify poll failed for run ${run.id}: ${res.status}`);
        run = ((await res.json()) as { data: ApifyRun }).data;
    }
    if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run ${run.id} (${actor}) ended ${run.status}: ${run.statusMessage ?? ''}`);
    }

    const items = await fetch(`${BASE}/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, {
        headers: h,
    });
    if (!items.ok) throw new Error(`Apify dataset fetch failed for run ${run.id}: ${items.status}`);
    return items.json() as Promise<unknown[]>;
}
