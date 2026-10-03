/**
 * Digest email rendering. Plain template literals — no email framework, no SDK.
 * HTML is a single ~600px table with fully inline styles and explicit light
 * colors: email clients strip stylesheets, and Gmail's forced-dark mode inverts
 * sanely from an explicit white background.
 *
 * Delivery itself happens in the GitHub Actions runner over Gmail SMTP
 * (scripts/send-digest.mjs) — Vercel blocks outbound SMTP. (ADR-025/026)
 */
import { formatDate, formatCityLabel } from '@/lib/format';

export interface DigestItem {
    title: string;
    slug: string;
    date: string;
    endDate?: string;
    city: string;
    country: string;
    region?: string;
    mode: string;
    url: string;
    /** Matched interest-rule labels (new-event rows). */
    labels?: string[];
    /** The subscriber's act-by date (plain-text fallback). */
    deadline?: string;
    /** Deadline tier line worded for this subscriber ("Priority deadline Sep 13 — …"). */
    deadlineLabel?: string;
    /** Caveat: stale "open", not-yet-open, or deadline-not-published. */
    note?: string;
    /** Travel-reimbursement note, when known. */
    travel?: string;
}

export interface DigestSections {
    /** Deadline reminders, one row per tier. */
    deadlines: DigestItem[];
    appsOpen: DigestItem[];
    /** In-person majors with no published deadline (F6). */
    risks: DigestItem[];
    newEvents: DigestItem[];
}

export interface RenderedEmail {
    subject: string;
    html: string;
    text: string;
    /** RFC 8058 one-click unsubscribe + RFC 2369 headers. */
    headers: Record<string, string>;
}

/**
 * RFC 3834 marker: honest about automated mail and stops vacation responders
 * replying to it. Standard, but its effect on Gmail *sorting* is unproven — if
 * spam placement is ever traced to it, flip this to false and re-test.
 */
const SEND_AUTO_SUBMITTED = true;

const MUTED = 'color:#6b7280;font-size:13px;';
const STRONG = 'color:#111827;font-size:13px;font-weight:600;';
const LINK = 'color:#2563eb;text-decoration:none;font-weight:600;';

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemRow(siteUrl: string, item: DigestItem, extra?: string): string {
    const where = formatCityLabel(item);
    const when = `${formatDate(item.date)}${item.endDate && item.endDate !== item.date ? ` – ${formatDate(item.endDate)}` : ''}`;
    const notes = [item.travel ? escapeHtml(item.travel) : ''].filter(Boolean);
    return `
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <a href="${siteUrl}/events/${item.slug}" style="${LINK}font-size:15px;">${escapeHtml(item.title)}</a>
        ${item.deadlineLabel ? `<div style="${STRONG}padding-top:3px;">${escapeHtml(item.deadlineLabel)}</div>` : ''}
        <div style="${MUTED}padding-top:2px;">Event ${when} · ${escapeHtml(where)}${extra ?? ''}</div>
        ${item.note ? `<div style="${MUTED}padding-top:2px;font-style:italic;">${escapeHtml(item.note)}</div>` : ''}
        ${notes.length ? `<div style="${MUTED}padding-top:2px;">${notes.join(' · ')}</div>` : ''}
      </td></tr>`;
}

function section(title: string, rows: string): string {
    if (!rows) return '';
    return `
      <tr><td style="padding:22px 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">${title}</td></tr>
      ${rows}`;
}

export function renderDigest(
    sections: DigestSections,
    siteUrl: string,
    todayLabel: string,
    opts: { email: string; unsubscribeUrl: string; oneClickUrl: string; manageUrl: string; sender?: string; urgent?: boolean },
): RenderedEmail {
    const counts = [
        sections.deadlines.length ? `${sections.deadlines.length} deadline${sections.deadlines.length === 1 ? '' : 's'} closing soon` : '',
        sections.appsOpen.length ? `${sections.appsOpen.length} application${sections.appsOpen.length === 1 ? '' : 's'} open` : '',
        sections.newEvents.length ? `${sections.newEvents.length} new for you` : '',
        sections.risks.length ? `${sections.risks.length} to check` : '',
    ].filter(Boolean);
    // Urgent sends lead with the one thing that matters: what closes, and when.
    const subject = opts.urgent
        ? sections.deadlines.length === 1
            ? `Closing soon: ${sections.deadlines[0].title} — ${sections.deadlines[0].deadlineLabel?.split(' · ')[0] ?? 'apply now'}`
            : `${sections.deadlines.length} hackathon deadlines in the next 3 days`
        : `Northbound: ${counts.join(' · ')} — ${todayLabel}`;

    const applyExtra = (item: DigestItem) => ` · <a href="${item.url}" style="${LINK}">Apply →</a>`;
    const host = (() => {
        try {
            return new URL(siteUrl).hostname;
        } catch {
            return 'northbound-dev.vercel.app';
        }
    })();
    const sender = opts.sender;
    // One "why you got this" line at the foot instead of repeating it under
    // every row — same transparency, far less machine-generated boilerplate.
    const matchedSummary = [...new Set(sections.newEvents.flatMap((i) => i.labels ?? []))].join(', ');

    const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;max-width:600px;width:100%;border-radius:12px;padding:28px 32px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
      <tr><td style="font-size:18px;font-weight:700;padding-bottom:2px;">${opts.urgent ? 'Deadline alert' : 'Northbound digest'}</td></tr>
      <tr><td style="${MUTED}">${todayLabel}${opts.urgent ? ' · sent because a deadline is under 3 days away — your regular digest is unchanged' : ''}</td></tr>
      ${section('Closing soon — apply now', sections.deadlines.map((i) => itemRow(siteUrl, i, applyExtra(i))).join(''))}
      ${section('Applications opened', sections.appsOpen.map((i) => itemRow(siteUrl, i, applyExtra(i))).join(''))}
      ${section('Deadline not published — check these', sections.risks.map((i) => itemRow(siteUrl, i, ` · <a href="${i.url}" style="${LINK}">Event site →</a>`)).join(''))}
      ${section('New for you', sections.newEvents.map((i) => itemRow(siteUrl, i)).join(''))}
      <tr><td style="padding-top:24px;border-top:1px solid #e5e7eb;">
        <div style="${MUTED}">
          ${matchedSummary ? `Matched your interests: ${escapeHtml(matchedSummary)}.<br>` : ''}
          You're receiving this because ${escapeHtml(opts.email)} subscribed to the Northbound event digest.<br>
          <a href="${opts.manageUrl}" style="${LINK}">Change what you get</a> ·
          <a href="${opts.unsubscribeUrl}" style="${LINK}">Unsubscribe</a> ·
          <a href="${siteUrl}" style="${LINK}">northbound</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`;

    const textLine = (i: DigestItem) =>
        [
            `- ${i.title} — event ${i.date}${i.city ? ` — ${i.city}` : ''}`,
            i.deadlineLabel ? `  ${i.deadlineLabel}` : '',
            i.note ? `  (${i.note})` : '',
            `  ${siteUrl}/events/${i.slug}`,
        ]
            .filter(Boolean)
            .join('\n');
    const text = [
        `${opts.urgent ? 'Northbound deadline alert' : 'Northbound digest'} — ${todayLabel}`,
        sections.deadlines.length ? `\nClosing soon — apply now:\n${sections.deadlines.map(textLine).join('\n')}` : '',
        sections.appsOpen.length ? `\nApplications opened:\n${sections.appsOpen.map(textLine).join('\n')}` : '',
        sections.risks.length ? `\nDeadline not published — check these:\n${sections.risks.map(textLine).join('\n')}` : '',
        sections.newEvents.length ? `\nNew for you:\n${sections.newEvents.map(textLine).join('\n')}` : '',
        `\n—\nYou're receiving this because ${opts.email} subscribed to the Northbound event digest.`,
        `Change what you get: ${opts.manageUrl}`,
        `Unsubscribe: ${opts.unsubscribeUrl}`,
    ]
        .filter(Boolean)
        .join('\n');

    return {
        subject,
        html,
        text,
        headers: {
            // RFC 2369 + RFC 8058: mailbox providers render a native unsubscribe
            // control and POST here; the endpoint honors it immediately.
            'List-Unsubscribe': `<${opts.oneClickUrl}>${sender ? `, <mailto:${sender}?subject=unsubscribe>` : ''}`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            // RFC 2919 requires a domain-style identifier here. The previous
            // `<digest.northbound>` was malformed, which filters read as a
            // (mild) bad signal rather than as list metadata.
            'List-Id': `Northbound event digest <digest.${host}>`,
            ...(SEND_AUTO_SUBMITTED ? { 'Auto-Submitted': 'auto-generated' } : {}),
        },
    };
}
