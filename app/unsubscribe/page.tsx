import type { Metadata } from 'next';
import Link from 'next/link';
import { MailX } from 'lucide-react';
import UnsubscribeButton from '@/components/UnsubscribeButton';
import { getSubscriberByToken } from '@/lib/subscribers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Unsubscribe — Northbound',
    robots: { index: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UnsubscribePage = async ({ searchParams }: { searchParams: SearchParams }) => {
    const sp = await searchParams;
    const raw = sp.token;
    const token = Array.isArray(raw) ? raw[0] : raw;
    const sub = await getSubscriberByToken(token);

    return (
        <section className="mx-auto flex w-full max-w-xl flex-col gap-6">
            <div className="border-border-dark bg-dark-100/40 flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center">
                <MailX className="text-light-200 size-10" aria-hidden />
                {!sub ? (
                    <>
                        <p className="text-lg font-semibold">Link not recognized</p>
                        <p className="text-light-200 text-sm">
                            This unsubscribe link is no longer valid — the address may already be unsubscribed.
                        </p>
                        <Link href="/" className="pill hover:border-light-200/50">
                            Go home
                        </Link>
                    </>
                ) : sub.status === 'unsubscribed' ? (
                    <>
                        <p className="text-lg font-semibold">Already unsubscribed</p>
                        <p className="text-light-200 text-sm">
                            {sub.email} isn&apos;t receiving the digest.{' '}
                            <Link href={`/subscribe?token=${token}`} className="text-primary hover:underline">
                                Resubscribe
                            </Link>
                            .
                        </p>
                    </>
                ) : (
                    <UnsubscribeButton token={token!} email={sub.email} />
                )}
            </div>
        </section>
    );
};

export default UnsubscribePage;
