import Link from 'next/link';
import Image from 'next/image';

const LINKS = [
    { href: '/events', label: 'All events' },
    { href: '/events?category=hackathon', label: 'Hackathons' },
    { href: '/events?source=company', label: 'Companies' },
];

const Navbar = () => (
    <header>
        <nav>
            <Link href="/" className="logo">
                <Image src="/icons/logo.png" alt="DevEvents logo" width={24} height={24} />
                <p>DevEvents</p>
            </Link>

            <ul className="list-none">
                {LINKS.map(({ href, label }) => (
                    <li key={label}>
                        <Link href={href} className="text-light-100 hover:text-primary text-sm font-medium transition max-sm:text-xs">
                            {label}
                        </Link>
                    </li>
                ))}
            </ul>
        </nav>
    </header>
);

export default Navbar;
