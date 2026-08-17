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
    /** Matched interest-rule labels (section A rows). */
    labels?: string[];
    /** Application deadline (hackathon sections). */
    deadline?: string;
    /** Travel-reimbursement note, when known. */
    travel?: string;
}

export interface DigestSections {
    newEvents: DigestItem[];
    appsOpen: DigestItem[];
    deadlines: DigestItem[];
}

export interface RenderedEmail {
    subject: string;
    html: string;
    text: string;
    /** RFC 8058 one-click unsubscribe + RFC 2369 headers. */
    headers: Record<string, string>;
}

const MUTED = 'color:#6b7280;font-size:13px;';
const LINK = 'color:#2563eb;text-decoration:none;font-weight:600;';

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemRow(siteUrl: string, item: DigestItem, extra?: string): string {
    const where = formatCityLabel(item);
    const when = `${formatDate(item.date)}${item.endDate && item.endDate !== item.date ? ` – ${formatDate(item.endDate)}` : ''}`;
    const notes = [
        item.deadline ? `Apply by ${formatDate(item.deadline)}` : '',
        item.travel ? escapeHtml(item.travel) : '',
    ].filter(Boolean);
    return `
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <a href="${siteUrl}/events/${item.slug}" style="${LINK}font-size:15px;">${escapeHtml(item.title)}</a>
        <div style="${MUTED}padding-top:2px;">${when} · ${escapeHtml(where)}${extra ?? ''}</div>
        ${notes.length ? `<div style="${MUTED}padding-top:2px;">${notes.join(' · ')}</div>` : ''}
        ${item.labels?.length ? `<div style="${MUTED}padding-top:2px;">matched: ${escapeHtml(item.labels.join(', '))}</div>` : ''}
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
    opts: { email: string; unsubscribeUrl: string; oneClickUrl: string; manageUrl: string },
): RenderedEmail {
    const counts = [
        sections.newEvents.length ? `${sections.newEvents.length} new for you` : '',
        sections.appsOpen.length ? `${sections.appsOpen.length} application${sections.appsOpen.length === 1 ? '' : 's'} open` : '',
        sections.deadlines.length ? `${sections.deadlines.length} deadline${sections.deadlines.length === 1 ? '' : 's'} approaching` : '',
    ].filter(Boolean);
    const subject = `Northbound: ${counts.join(' · ')} — ${todayLabel}`;

    const applyExtra = (item: DigestItem) => ` · <a href="${item.url}" style="${LINK}">Apply →</a>`;

    const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;max-width:600px;width:100%;border-radius:12px;padding:28px 32px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
      <tr><td style="font-size:18px;font-weight:700;padding-bottom:2px;">Northbound digest</td></tr>
      <tr><td style="${MUTED}">${todayLabel}</td></tr>
      ${section('Applications now open', sections.appsOpen.map((i) => itemRow(siteUrl, i, applyExtra(i))).join(''))}
      ${section('Deadlines approaching', sections.deadlines.map((i) => itemRow(siteUrl, i, applyExtra(i))).join(''))}
      ${section('New events for you', sections.newEvents.map((i) => itemRow(siteUrl, i)).join(''))}
      <tr><td style="padding-top:24px;border-top:1px solid #e5e7eb;">
        <div style="${MUTED}">
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
        `- ${i.title} — ${i.date}${i.city ? ` — ${i.city}` : ''}${i.deadline ? ` — apply by ${i.deadline}` : ''}\n  ${siteUrl}/events/${i.slug}`;
    const text = [
        `Northbound digest — ${todayLabel}`,
        sections.appsOpen.length ? `\nApplications now open:\n${sections.appsOpen.map(textLine).join('\n')}` : '',
        sections.deadlines.length ? `\nDeadlines approaching:\n${sections.deadlines.map(textLine).join('\n')}` : '',
        sections.newEvents.length ? `\nNew events for you:\n${sections.newEvents.map(textLine).join('\n')}` : '',
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
            'List-Unsubscribe': `<${opts.oneClickUrl}>, <mailto:northbound.dev.events@gmail.com?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'List-Id': `Northbound event digest <digest.northbound>`,
        },
    };
}
