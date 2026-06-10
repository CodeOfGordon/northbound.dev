import Link from 'next/link';

const Footer = () => (
    <footer className="border-dark-200 mt-auto border-t">
        <div className="text-light-200 mx-auto container flex flex-col gap-2 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <p>
                <span className="font-semibold text-white">DevEvents</span> — tech, AI &amp; data events across
                the GTA, Ottawa &amp; Quebec.
            </p>
            <p>
                Aggregated nightly from Luma, Eventbrite, Meetup, MLH &amp; company sites ·{' '}
                <Link href="/events" className="hover:text-primary underline underline-offset-4">
                    Browse all
                </Link>
            </p>
        </div>
    </footer>
);

export default Footer;
