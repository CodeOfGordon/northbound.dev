import type { Metadata } from 'next';
import { BellRing, CalendarClock, Plane } from 'lucide-react';
import SubscribeForm from '@/components/SubscribeForm';
import { getSubscriberByToken } from '@/lib/subscribers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Email digest — Northbound',
    description:
        'Get an email when hackathons open applications, when deadlines approach, and when new events match what you care about.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PITCH = [
    { icon: BellRing, title: 'Applications, not just dates', body: 'Told the day we see a hackathon’s applications open, however far away the event is.' },
    { icon: CalendarClock, title: 'Deadline reminders', body: 'Priority and regular deadlines reminded separately — the one that applies to where you’re applying from — with a final alert inside 72 hours.' },
    { icon: Plane, title: 'Travel-covered filter', body: 'For US hackathons, optionally only the ones confirmed to reimburse travel.' },
];

const SubscribePage = async ({ searchParams }: { searchParams: SearchParams }) => {
    const sp = await searchParams; // Next 16: searchParams is a Promise
    const raw = sp.token;
    const token = Array.isArray(raw) ? raw[0] : raw;
    const existing = await getSubscriberByToken(token);

    return (
        <section className="mx-auto flex w-full max-w-2xl flex-col gap-10">
            <div className="flex flex-col gap-3">
                <h1 className="text-4xl max-sm:text-3xl">{existing ? 'Your digest preferences' : 'Get the digest'}</h1>
                <p className="text-light-200 max-sm:text-sm">
                    {existing ? (
                        <>
                            Updating what <span className="text-light-100">{existing.email}</span> receives.
                            {existing.status === 'unsubscribed' && ' Saving will resubscribe this address.'}
                        </>
                    ) : (
                        'On your schedule — weekly by default — plus a deadline alert when something you care about closes within 3 days. No email on quiet days.'
                    )}
                </p>
            </div>

            {!existing && (
                <ul className="flex list-none flex-col gap-3">
                    {PITCH.map(({ icon: Icon, title, body }) => (
                        <li key={title} className="flex items-start gap-3">
                            <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                            <span className="flex flex-col gap-0.5">
                                <span className="text-sm font-semibold">{title}</span>
                                <span className="text-light-200 text-sm">{body}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            <div className="border-border-dark bg-dark-100/40 card-shadow rounded-xl border p-6 max-sm:p-4">
                <SubscribeForm token={existing ? token : undefined} initial={existing ?? undefined} />
            </div>
        </section>
    );
};

export default SubscribePage;
