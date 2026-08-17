/**
 * send-digest.mjs — nightly digest delivery via Gmail SMTP, run in the GitHub
 * Actions runner (Vercel blocks outbound SMTP — ADR-025). All digest logic
 * lives server-side behind /api/digest; this script only orchestrates:
 *
 *   compose (server builds + renders, no state change)
 *     → nodemailer send via smtp.gmail.com (authentic Gmail from the account)
 *       → confirm (server advances cursor + stamps notifiedOpenAt)
 *
 * A failed send exits 1 with nothing confirmed — the digest retries in full
 * next run (at-least-once, same contract as the old in-process path).
 *
 * Env: SITE_URL, CRON_SECRET (existing secrets) + GMAIL_USER,
 * GMAIL_APP_PASSWORD (Google App Password, needs 2FA), DIGEST_EMAIL
 * (comma-separated recipients).
 */
import nodemailer from 'nodemailer';

function env(name, { optional = false } = {}) {
    const v = process.env[name]?.trim();
    if (!v && !optional) {
        console.warn(`::warning::${name} is not set — skipping digest.`);
        process.exit(0); // not-configured is a soft skip, not a red nightly job
    }
    return v ?? '';
}

const SITE_URL = env('SITE_URL').replace(/\/$/, '');
const CRON_SECRET = env('CRON_SECRET');
const GMAIL_USER = env('GMAIL_USER');
const GMAIL_APP_PASSWORD = env('GMAIL_APP_PASSWORD');
const recipients = env('DIGEST_EMAIL').split(',').map((s) => s.trim()).filter(Boolean);

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

try {
    const composed = await api({ mode: 'compose', to: recipients });
    console.log('compose:', JSON.stringify({ ...composed, html: composed.html ? `[${composed.html.length} chars]` : undefined, text: composed.text ? '[omitted]' : undefined }));

    if (composed.skipped || composed.initialized || composed.empty) {
        console.log('Nothing to send.');
        process.exit(0);
    }

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
        from: `Northbound <${GMAIL_USER}>`, // Gmail requires from = the authenticated account
        to: composed.to,
        subject: composed.subject,
        html: composed.html,
        text: composed.text,
    });
    console.log(`Sent to ${composed.to.join(', ')}`);

    const confirmed = await api({ mode: 'confirm', cursor: composed.cursor, openIds: composed.openIds });
    console.log('confirm:', JSON.stringify(confirmed));
} catch (e) {
    console.error(`Digest failed (state untouched — retries next run): ${e.message}`);
    process.exit(1);
}
