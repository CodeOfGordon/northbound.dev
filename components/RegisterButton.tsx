'use client';

import posthog from 'posthog-js';
import { ExternalLink } from 'lucide-react';
import { SOURCE_LABELS } from '@/lib/constants';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
}

/** Outbound link to the canonical event page — registration happens at the source. */
const RegisterButton = ({ event }: Props) => {
    // Hackathons are aggregated from several platforms (Devpost, DoraHacks, …), so a
    // single platform name would be misleading — just say "Register".
    const label = event.source === 'hackathon' ? 'Register' : `Register on ${SOURCE_LABELS[event.source]}`;
    return (
        <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
                posthog.capture('register_link_clicked', { slug: event.slug, title: event.title, source: event.source, url: event.url })
            }
            className="bg-primary flex-center hover:bg-primary/90 w-full cursor-pointer gap-2 rounded-lg px-4 py-3 text-base font-semibold text-black transition"
        >
            {label} <ExternalLink className="size-4" aria-hidden />
        </a>
    );
};

export default RegisterButton;
