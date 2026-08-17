'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';

// No DB reads, no PostHog capture — capture_exceptions already reports this via the SDK.
const Error = ({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) => {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="border-border-dark flex-center bg-dark-100/40 flex-col gap-3 rounded-xl border border-dashed px-6 py-20 text-center">
            <TriangleAlert className="text-light-200 size-10" aria-hidden />
            <p className="text-lg font-semibold">Something went wrong</p>
            <p className="text-light-200 text-sm">A live data read failed — this is usually temporary.</p>

            <button
                onClick={reset}
                className="bg-primary text-primary-foreground mt-3 rounded-full px-5 py-2.5 font-semibold"
            >
                Try again
            </button>
        </div>
    );
};

export default Error;
