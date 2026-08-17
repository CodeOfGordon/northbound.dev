/**
 * screenshot.mjs — capture a PNG of any URL using Playwright's bundled Chromium.
 * WSL-safe: no system Chrome needed (the chrome-devtools MCP is blocked here).
 *
 * Run from the repo root (no env file needed):
 *   node .claude/skills/northbound-diagnostics-and-tooling/scripts/screenshot.mjs <url> <out.png> [width] [height] [--full]
 * Examples:
 *   mkdir -p .screenshots && node .claude/skills/northbound-diagnostics-and-tooling/scripts/screenshot.mjs http://localhost:3000/events .screenshots/events.png
 *   node .claude/skills/northbound-diagnostics-and-tooling/scripts/screenshot.mjs http://localhost:3000 shot.png 390 844   # mobile viewport
 *
 * Requires the Chromium bundle in ~/.cache/ms-playwright (install once with:
 * npx playwright install chromium). Does NOT start any server — point it at an
 * already-running dev server or a static/file:// page.
 */
import { chromium } from 'playwright';

const [url, out, w, h] = process.argv.slice(2).filter((a) => a !== '--full');
const fullPage = process.argv.includes('--full');
if (!url || !out) {
    console.error('usage: node screenshot.mjs <url> <out.png> [width] [height] [--full]');
    process.exit(2);
}

const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: Number(w) || 1280, height: Number(h) || 800 } });
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(800); // let fonts/images/lazy content settle
    await page.screenshot({ path: out, fullPage });
    console.log(`saved ${out} (${fullPage ? 'full page' : `${Number(w) || 1280}x${Number(h) || 800}`}) from ${url}`);
} finally {
    await browser.close();
}
