/**
 * Test-runner bootstrap: `node --import ./tests/register.mjs --test …`.
 * Node 22 strips TypeScript types natively; this only teaches it the repo's
 * `@/` path alias and extensionless imports (tsconfig `paths`), so the tests
 * need no runner dependency. (ADR-029)
 */
import { register } from 'node:module';

register('./resolve-hook.mjs', import.meta.url);
