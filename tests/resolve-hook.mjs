/** ESM resolve hook: `@/x` → <repo>/x(.ts|.tsx|/index.ts); extensionless relative TS imports likewise. */
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts'];

function probe(base) {
    for (const ext of EXTS) {
        const p = base + ext;
        if (existsSync(p) && statSync(p).isFile()) return pathToFileURL(p).href;
    }
    return null;
}

export async function resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
        const hit = probe(path.join(ROOT, specifier.slice(2)));
        if (hit) return { url: hit, shortCircuit: true };
    }
    // Extensionless relative imports — including dotted names like './event.model'
    // whose "extension" is part of the module name, not a file type.
    const known = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs', '.json'];
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') && !known.includes(path.extname(specifier))) {
        const hit = probe(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
        if (hit) return { url: hit, shortCircuit: true };
    }
    return next(specifier, context);
}
