import Link from 'next/link';
import { CalendarX2 } from 'lucide-react';

// No DB reads — this page prerenders at build, so it must stay static.
const NotFound = () => (
    <div className="border-border-dark flex-center bg-dark-100/40 flex-col gap-3 rounded-xl border border-dashed px-6 py-20 text-center">
        <CalendarX2 className="text-light-200 size-10" aria-hidden />
        <p className="text-lg font-semibold">Page not found</p>
        <p className="text-light-200 text-sm">This page or event doesn&apos;t exist — it may have ended or moved.</p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <Link href="/" className="bg-primary text-primary-foreground rounded-full px-5 py-2.5 font-semibold">
                Go home
            </Link>
            <Link href="/events" className="pill">
                Browse events
            </Link>
        </div>
    </div>
);

export default NotFound;
