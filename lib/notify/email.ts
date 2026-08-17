/**
 * Digest email rendering + delivery. Plain template literals and a raw fetch
 * to Resend's HTTP API — no email framework, no SDK dependency (~15 lines of
 * HTTP replaces the package; ADR-021). HTML is a single ~600px table with
 * fully inline styles and explicit light colors: email clients strip
 * stylesheets, and Gmail's forced-dark mode inverts sanely from an explicit
 * white background.
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
}

export interface DigestSections {
    newEvents: DigestItem[];
    appsOpen: DigestItem[];
    deadlines: DigestItem[];
}

const MUTED = 'color:#6b7280;font-size:13px;';
const LINK = 'color:#2563eb;text-decoration:none;font-weight:600;';

function itemRow(siteUrl: string, item: DigestItem, extra?: string): string {
    const where = formatCityLabel(item);
    const when = `${formatDate(item.date)}${item.endDate && item.endDate !== item.date ? ` – ${formatDate(item.endDate)}` : ''}`;
    return `
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <a href="${siteUrl}/events/${item.slug}" style="${LINK}font-size:15px;">${escapeHtml(item.title)}</a>
        <div style="${MUTED}padding-top:2px;">${when} · ${escapeHtml(where)}${extra ?? ''}</div>
        ${item.labels?.length ? `<div style="${MUTED}padding-top:2px;">matched: ${escapeHtml(item.labels.join(', '))}</div>` : ''}
      </td></tr>`;
}

function section(title: string, rows: string): string {
    if (!rows) return '';
    return `
      <tr><td style="padding:22px 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">${title}</td></tr>
      ${rows}`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderDigest(sections: DigestSections, siteUrl: string, todayLabel: string): { subject: string; html: string; text: string } {
    const counts = [
        sections.newEvents.length ? `${sections.newEvents.length} new for you` : '',
        sections.appsOpen.length ? `${sections.appsOpen.length} application${sections.appsOpen.length === 1 ? '' : 's'} open` : '',
        sections.deadlines.length ? `${sections.deadlines.length} deadline${sections.deadlines.length === 1 ? '' : 's'} approaching` : '',
    ].filter(Boolean);
    const subject = `Northbound: ${counts.join(' · ')} — ${todayLabel}`;

    const applyExtra = (item: DigestItem) =>
        ` · <a href="${item.url}" style="${LINK}">Apply →</a>` +
        (item.deadline ? ` <span style="${MUTED}">by ${formatDate(item.deadline)}</span>` : '');

    const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;max-width:600px;width:100%;border-radius:12px;padding:28px 32px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
      <tr><td style="font-size:18px;font-weight:700;padding-bottom:2px;">Northbound digest</td></tr>
      <tr><td style="${MUTED}">${todayLabel}</td></tr>
      ${section('Applications now open', sections.appsOpen.map((i) => itemRow(siteUrl, i, applyExtra(i))).join(''))}
      ${section('Deadlines approaching', sections.deadlines.map((i) => itemRow(siteUrl, i, applyExtra(i))).join(''))}
      ${section('New events for you', sections.newEvents.map((i) => itemRow(siteUrl, i)).join(''))}
      <tr><td style="${MUTED}padding-top:22px;">Sent by your Northbound digest · <a href="${siteUrl}/events?category=hackathon" style="${LINK}">browse hackathons</a> · edit config/interests.ts to tune this</td></tr>
    </table>
  </td></tr>
</table>`;

    const textLine = (i: DigestItem) => `- ${i.title} — ${i.date}${i.city ? ` — ${i.city}` : ''} — ${siteUrl}/events/${i.slug}`;
    const text = [
        `Northbound digest — ${todayLabel}`,
        sections.appsOpen.length ? `\nApplications now open:\n${sections.appsOpen.map(textLine).join('\n')}` : '',
        sections.deadlines.length ? `\nDeadlines approaching:\n${sections.deadlines.map(textLine).join('\n')}` : '',
        sections.newEvents.length ? `\nNew events for you:\n${sections.newEvents.map(textLine).join('\n')}` : '',
    ].filter(Boolean).join('\n');

    return { subject, html, text };
}

/** Send via Resend's HTTP API. Returns null on success, an error string on failure — never throws. */
export async function sendEmail(args: { apiKey: string; to: string[]; subject: string; html: string; text: string }): Promise<string | null> {
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // Default sender works without a verified domain but only delivers to
                // the Resend account owner. Verify a domain (Resend → Domains, free)
                // and set DIGEST_FROM to an address on it to reach other recipients.
                from: process.env.DIGEST_FROM ?? 'Northbound <onboarding@resend.dev>',
                to: args.to,
                subject: args.subject,
                html: args.html,
                text: args.text,
            }),
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return `resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
        return null;
    } catch (e) {
        return `resend request failed: ${(e as Error).message}`;
    }
}
