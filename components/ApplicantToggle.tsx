'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import posthog from 'posthog-js';
import { Loader2 } from 'lucide-react';
import { APPLICANT_COOKIE, serializeApplicant, type Applicant } from '@/lib/hackathon';
import { cn } from '@/lib/utils';

interface Props {
    applicant: Applicant;
    className?: string;
}

const COUNTRIES: { value: Applicant['country']; label: string }[] = [
    { value: 'CA', label: 'Canada' },
    { value: 'US', label: 'the U.S.' },
    { value: 'OTHER', label: 'elsewhere' },
];

/**
 * "Applying from" control for the hackathon views (ADR-029). Which deadline
 * tier is yours depends on it: travelling in from another country (or needing
 * travel money) makes the priority round your act-by date. There are no
 * accounts, so the choice lives in a cookie the server reads per request; the
 * refresh re-resolves every badge and deadline server-side.
 */
const ApplicantToggle = ({ applicant, className }: Props) => {
    const router = useRouter();
    const [pending, start] = useTransition();

    const save = (next: Applicant) => {
        document.cookie = `${APPLICANT_COOKIE}=${serializeApplicant(next)}; path=/; max-age=31536000; samesite=lax`;
        posthog.capture('applicant_profile_changed', { country: next.country, wantsTravel: next.wantsTravel });
        start(() => router.refresh());
    };

    return (
        <div className={cn('text-light-200 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm', className)}>
            <label className="flex items-center gap-2">
                <span>Applying from</span>
                <select
                    className="field py-1.5"
                    value={applicant.country}
                    onChange={(e) => save({ ...applicant, country: e.target.value as Applicant['country'] })}
                >
                    {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>
                            {c.label}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={applicant.wantsTravel}
                    onChange={(e) => save({ ...applicant, wantsTravel: e.target.checked })}
                    className="accent-primary size-4 cursor-pointer"
                />
                <span>I&apos;d need travel support</span>
            </label>
            {pending && <Loader2 className="text-primary size-4 animate-spin motion-reduce:animate-none" aria-label="Updating" />}
        </div>
    );
};

export default ApplicantToggle;
