/**
 * The viewer's applicant profile for this request (ADR-029). There are no
 * accounts, so it comes from the "Applying from" control's cookie, defaulting
 * from Vercel's IP-country header when the viewer hasn't chosen. Nothing is
 * stored server-side. Fail-safe: outside a request scope (scripts, build-time
 * prerender) it returns the default rather than throwing.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { APPLICANT_COOKIE, DEFAULT_APPLICANT, parseApplicant, type Applicant } from '@/lib/hackathon';

export async function getApplicant(): Promise<Applicant> {
    try {
        const [jar, hdrs] = await Promise.all([cookies(), headers()]);
        return parseApplicant(jar.get(APPLICANT_COOKIE)?.value, hdrs.get('x-vercel-ip-country'));
    } catch {
        return DEFAULT_APPLICANT;
    }
}

/** True when the profile came from an explicit choice rather than the IP default. */
export async function hasChosenApplicant(): Promise<boolean> {
    try {
        return (await cookies()).has(APPLICANT_COOKIE);
    } catch {
        return false;
    }
}
