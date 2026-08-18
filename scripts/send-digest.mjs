/**
 * send-digest.mjs — nightly digest delivery via Gmail SMTP, run in the GitHub
 * Actions runner (Vercel blocks outbound SMTP — ADR-025). All digest logic
 * lives server-side behind /api/digest; this script only orchestrates:
 *
 *   compose (server builds one personalized message per subscriber, no writes)
 *     → nodemailer sends each via smtp.gmail.com (authentic Gmail, SPF/DKIM pass)
 *       → confirm (server advances each delivered subscriber's cursor/markers)
 *
 * Only delivered messages are confirmed: if one recipient's send fails the
 * others still count, and the failed one retries in full next run
 * (at-least-once). Exit 1 on any failure so the job goes red.
 *
 * Env: SITE_URL, CRON_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD (Google App
 * Password — needs 2FA on the account).
 * Flags: --force (bypass the same-day guard), --dry-run (compose + print only).
 */
import nodemailer from 'nodemailer';

function env(name) {
    const v = process.env[name]?.trim();
    if (!v) {
        console.warn(`::warning::${name} is not set — skipping digest.`);
        process.exit(0); // not-configured is a soft skip, not a red nightly job
    }
    return v;
}

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
/**
 * Redirect this run's mail to one address (deliverability testing — e.g. a
 * mail-tester.com address). Nothing is confirmed, so no subscriber state moves.
 */
const TO_OVERRIDE = (() => {
    const i = process.argv.indexOf('--to');
    return i >= 0 ? String(process.argv[i + 1] ?? '').trim() : '';
})();

const SITE_URL = env('SITE_URL').replace(/\/$/, '');
const CRON_SECRET = env('CRON_SECRET');
const GMAIL_USER = DRY_RUN ? (process.env.GMAIL_USER ?? '') : env('GMAIL_USER');
const GMAIL_APP_PASSWORD = DRY_RUN ? (process.env.GMAIL_APP_PASSWORD ?? '') : env('GMAIL_APP_PASSWORD');

async function api(body) {
    const res = await fetch(`${SITE_URL}/api/digest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`digest api ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
}

const composed = await api({ mode: 'compose', force: FORCE, dryRun: DRY_RUN, sender: GMAIL_USER });
const messages = composed.messages ?? [];
console.log(`compose: ${composed.subscribers ?? 0} active subscriber(s), ${messages.length} message(s)` +
    (composed.skipped ? ` — ${composed.skipped}` : ''));

if (!messages.length) {
    console.log('Nothing to send.');
    process.exit(0);
}
for (const m of messages) {
    console.log(`  → ${m.to.join(', ')}: ${JSON.stringify(m.counts)} "${m.subject}"`);
}
if (DRY_RUN) {
    console.log('Dry run: nothing sent, nothing confirmed.');
    process.exit(0);
}

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const delivered = [];
let failures = 0;

for (const m of messages) {
    try {
        const info = await transporter.sendMail({
            from: `Northbound <${GMAIL_USER}>`, // Gmail requires from = the authenticated account
            replyTo: GMAIL_USER, // a real, monitored reply path reads as legitimate mail
            to: TO_OVERRIDE || m.to,
            subject: m.subject,
            html: m.html,
            text: m.text,
            headers: m.headers, // List-Unsubscribe + one-click (RFC 8058)
            // Thread onto their previous digest: Gmail keeps one conversation,
            // so rescuing it from spam once carries to every later send.
            ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: [m.inReplyTo] } : {}),
        });
        // A redirected test send must not advance anyone's real state.
        if (!TO_OVERRIDE) {
            delivered.push({ subscriberId: m.subscriberId, openIds: m.openIds ?? [], messageId: info?.messageId });
        }
        console.log(`sent → ${TO_OVERRIDE || m.to.join(', ')}${m.inReplyTo ? ' (threaded)' : ''}${TO_OVERRIDE ? ' [test redirect — not confirmed]' : ''}`);
    } catch (e) {
        failures += 1;
        console.error(`::error::send failed for ${m.to.join(', ')}: ${e.message}`);
    }
}

if (delivered.length) {
    const confirmed = await api({ mode: 'confirm', cursor: composed.cursor, results: delivered });
    console.log('confirm:', JSON.stringify(confirmed));
}

if (failures) {
    console.error(`${failures} of ${messages.length} message(s) failed — they retry next run.`);
    process.exit(1);
}
