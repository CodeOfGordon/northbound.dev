import Link from 'next/link';
import FreshnessBadge from '@/components/FreshnessBadge';
import { getScrapeStatus } from '@/lib/meta';

const Footer = async () => {
    const { lastRunAt } = await getScrapeStatus();

    return (
        <footer className="border-border-dark mt-auto border-t">
            <div className="text-light-200 container mx-auto flex flex-col gap-4 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="flex flex-col gap-2">
                    <p>
                        <span className="text-foreground font-semibold">Northbound</span> — official dev events,
                        hackathons &amp; meetups across North America.
                    </p>
                    <p className="text-light-200/80 text-xs">
                        Aggregated from Luma, Eventbrite, Meetup, MLH &amp; company sites ·{' '}
                        <Link href="/events" className="hover:text-primary underline underline-offset-4">
                            Browse all
                        </Link>
                    </p>
                </div>
                <FreshnessBadge lastRunAt={lastRunAt} />
            </div>
        </footer>
    );
};

export default Footer;
