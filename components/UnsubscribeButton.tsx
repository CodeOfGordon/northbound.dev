'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2 } from 'lucide-react';

interface Props {
    token: string;
    email: string;
}

/** Confirm-then-unsubscribe. The one-click header path posts to the same API. */
const UnsubscribeButton = ({ token, email }: Props) => {
    const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

    if (state === 'done') {
        return (
            <div className="flex flex-col items-center gap-3">
                <Check className="text-primary size-10" aria-hidden />
                <p className="text-lg font-semibold">Unsubscribed</p>
                <p className="text-light-200 text-sm">
                    {email} won&apos;t receive the digest anymore. Changed your mind?{' '}
                    <Link href={`/subscribe?token=${token}`} className="text-primary hover:underline">
                        Resubscribe
                    </Link>
                    .
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center gap-4">
            <p className="text-light-200 text-sm">
                Stop sending the Northbound digest to <span className="text-light-100">{email}</span>?
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                    type="button"
                    disabled={state === 'saving'}
                    onClick={async () => {
                        setState('saving');
                        try {
                            const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST' });
                            setState(res.ok ? 'done' : 'error');
                        } catch {
                            setState('error');
                        }
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-center cursor-pointer gap-2 rounded-full px-5 py-2.5 font-semibold transition disabled:opacity-50"
                >
                    {state === 'saving' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    Unsubscribe
                </button>
                <Link href={`/subscribe?token=${token}`} className="pill hover:border-light-200/50">
                    Change what I get instead
                </Link>
            </div>
            {state === 'error' && <p className="text-amber text-sm">That didn&apos;t work — try again in a moment.</p>}
        </div>
    );
};

export default UnsubscribeButton;
