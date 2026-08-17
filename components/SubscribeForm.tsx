'use client';

import { useState } from 'react';
import posthog from 'posthog-js';
import { Check, Loader2, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SubscribePrefs {
    email?: string;
    topics: string[];
    regions: string[];
    usTravelOnly: boolean;
    minDaysOut: number;
    frequency: string;
}

interface Props {
    /** Present when editing existing preferences from an emailed link. */
    token?: string;
    initial?: SubscribePrefs;
}

const TOPICS: { value: string; label: string; hint: string }[] = [
    { value: 'hackathon', label: 'Hackathons', hint: 'MLH, Devpost & university hackathons — with application status' },
    { value: 'company', label: 'Company events', hint: 'Official dev events from Google, AWS, Vercel, and others' },
    { value: 'community', label: 'Meetups & conferences', hint: 'Local community events, conferences, networking' },
];

const REGIONS: { value: string; label: string }[] = [
    { value: 'CA', label: 'Canada' },
    { value: 'US', label: 'United States' },
    { value: 'ONLINE', label: 'Online' },
];

const LEAD_TIMES: { value: number; label: string }[] = [
    { value: 0, label: 'Everything, however soon' },
    { value: 7, label: 'At least a week out' },
    { value: 21, label: 'At least 3 weeks out' },
    { value: 45, label: 'At least 6 weeks out' },
];

const FREQUENCIES: { value: string; label: string }[] = [
    { value: 'daily', label: 'Daily — as soon as something turns up' },
    { value: 'weekly', label: 'Weekly — one roundup (recommended)' },
    { value: 'biweekly', label: 'Every two weeks' },
    { value: 'monthly', label: 'Monthly' },
];

const DEFAULTS: SubscribePrefs = {
    topics: ['hackathon'],
    regions: ['CA', 'US'],
    usTravelOnly: false,
    minDaysOut: 21,
    frequency: 'weekly',
};

const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * Digest signup + preference editing. One form for both: with a `token` it
 * edits that subscriber (from an emailed link), otherwise it creates one.
 */
const SubscribeForm = ({ token, initial }: Props) => {
    const start = initial ?? DEFAULTS;
    const [email, setEmail] = useState(start.email ?? '');
    const [topics, setTopics] = useState<string[]>(start.topics);
    const [regions, setRegions] = useState<string[]>(start.regions);
    const [usTravelOnly, setUsTravelOnly] = useState(start.usTravelOnly);
    const [minDaysOut, setMinDaysOut] = useState(start.minDaysOut);
    const [frequency, setFrequency] = useState(start.frequency ?? 'weekly');
    const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
    const [error, setError] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setState('saving');
        setError('');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, topics, regions, usTravelOnly, minDaysOut, frequency, token }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? 'Something went wrong. Try again.');
            posthog.capture('digest_subscribed', { topics, regions, usTravelOnly, minDaysOut, frequency, updated: !!token });
            setState('done');
        } catch (err) {
            setError((err as Error).message);
            setState('idle');
        }
    };

    if (state === 'done') {
        return (
            <div className="border-border-dark bg-dark-100/40 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
                <Check className="text-primary size-10" aria-hidden />
                <p className="text-lg font-semibold">{token ? 'Preferences saved' : "You're subscribed"}</p>
                <p className="text-light-200 max-w-md text-sm">
                    {token
                        ? 'Your next digest will use the updated filters.'
                        : `We'll email ${email} when something matching turns up — and when hackathon applications open. Nothing to say that day means no email.`}
                </p>
            </div>
        );
    }

    const checkbox = (checked: boolean, onChange: () => void, label: string, hint?: string) => (
        <label
            key={label}
            className={cn(
                'border-border-dark bg-dark-100/50 hover:bg-dark-100 flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
                checked && 'border-primary/50',
            )}
        >
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                className="accent-primary mt-0.5 size-4 shrink-0 cursor-pointer"
            />
            <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                {hint && <span className="text-light-200 text-xs">{hint}</span>}
            </span>
        </label>
    );

    return (
        <form onSubmit={submit} className="flex flex-col gap-7">
            {!token && (
                <div className="flex flex-col gap-2">
                    <label htmlFor="email" className="label">
                        Email
                    </label>
                    <div className="relative">
                        <Mail className="text-light-200 absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
                        <input
                            id="email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="bg-dark-100 border-border-dark placeholder:text-light-200 focus:border-primary/60 focus:ring-primary/20 w-full rounded-lg border py-2.5 pl-9 pr-4 text-sm transition-colors focus:outline-none focus:ring-2"
                        />
                    </div>
                </div>
            )}

            <fieldset className="flex flex-col gap-2">
                <legend className="label mb-2">What do you want to hear about?</legend>
                {TOPICS.map((t) => checkbox(topics.includes(t.value), () => setTopics((p) => toggle(p, t.value)), t.label, t.hint))}
            </fieldset>

            <fieldset className="flex flex-col gap-2">
                <legend className="label mb-2">Where?</legend>
                <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                    {REGIONS.map((r) => checkbox(regions.includes(r.value), () => setRegions((p) => toggle(p, r.value)), r.label))}
                </div>
                {regions.includes('US') && topics.includes('hackathon') && (
                    <div className="mt-1">
                        {checkbox(
                            usTravelOnly,
                            () => setUsTravelOnly((v) => !v),
                            'US hackathons: only ones that cover travel',
                            'Skips US in-person hackathons unless we have confirmed they offer travel reimbursement',
                        )}
                    </div>
                )}
            </fieldset>

            <div className="flex flex-col gap-2">
                <label htmlFor="frequency" className="label">
                    How often?
                </label>
                <select id="frequency" className="field w-full" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                    {FREQUENCIES.map((f) => (
                        <option key={f.value} value={f.value}>
                            {f.label}
                        </option>
                    ))}
                </select>
                <p className="text-light-200 text-xs">
                    Approaching application deadlines are always included in time — the reminder window widens to
                    cover the gap between emails.
                </p>
            </div>

            <div className="flex flex-col gap-2">
                <label htmlFor="lead" className="label">
                    How far ahead? <span className="normal-case">(hackathon applications close early)</span>
                </label>
                <select
                    id="lead"
                    className="field w-full"
                    value={minDaysOut}
                    onChange={(e) => setMinDaysOut(Number(e.target.value))}
                >
                    {LEAD_TIMES.map((l) => (
                        <option key={l.value} value={l.value}>
                            {l.label}
                        </option>
                    ))}
                </select>
            </div>

            {error && <p className="text-amber text-sm">{error}</p>}

            <div className="flex flex-col gap-3">
                <button
                    type="submit"
                    disabled={state === 'saving' || !topics.length || !regions.length}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-center w-full cursor-pointer gap-2 rounded-lg px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {state === 'saving' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {token ? 'Save preferences' : 'Subscribe'}
                </button>
                <p className="text-light-200 text-center text-xs">
                    Only sent when something matches — quiet periods mean no email. Unsubscribe in one click from any
                    email.
                </p>
            </div>
        </form>
    );
};

export default SubscribeForm;
