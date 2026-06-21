/**
 * Aggregated `hackathon` source — free public hackathon feeds beyond MLH:
 * Devpost (online slice), lu.ma AI/Tech discover, DoraHacks (virtual), ETHGlobal.
 * Each provider is isolated so one failure can't sink the others; region scoping,
 * relevance and cross-source dedup all happen downstream in the normalize/upsert path.
 */
import { fetchDevpost } from './devpost';
import { fetchLumaHackathons } from './luma';
import { fetchDoraHacks } from './dorahacks';
import { fetchEthGlobal } from './ethglobal';

export async function fetchHackathons(): Promise<unknown[]> {
    const providers: [string, () => Promise<unknown[]>][] = [
        ['devpost', fetchDevpost],
        ['luma', fetchLumaHackathons],
        ['dorahacks', fetchDoraHacks],
        ['ethglobal', fetchEthGlobal],
    ];

    const results = await Promise.all(
        providers.map(async ([name, fn]) => {
            try {
                return await fn();
            } catch (e) {
                console.warn(`hackathons: ${name} failed — ${(e as Error).message}`);
                return [];
            }
        }),
    );

    return results.flat();
}
