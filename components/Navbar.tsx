import Link from 'next/link';
import Image from 'next/image';

// Order mirrors the site lanes: companies first, hackathons, local, then everything
const LINKS = [
    { href: '/events?source=company', label: 'Companies' },
    { href: '/events?category=hackathon', label: 'Hackathons' },
    { href: '/events?source=local', label: 'Local' },
    { href: '/events', label: 'All events' },
];

const Navbar = () => (
    <header>
        <nav>
            <Link href="/" className="logo">
                <Image src="/icons/logo.png" alt="Northbound logo" width={26} height={26} priority />
                <p>Northbound</p>
            </Link>

            <ul className="flex list-none flex-row items-center gap-1">
                {LINKS.map(({ href, label }) => (
                    <li key={label}>
                        <Link
                            href={href}
                            className="text-light-200 hover:text-foreground hover:bg-dark-200/60 rounded-md px-3 py-1.5 text-sm font-medium transition-colors max-sm:px-2 max-sm:text-xs"
                        >
                            {label}
                        </Link>
                    </li>
                ))}
            </ul>
        </nav>
    </header>
);

export default Navbar;
