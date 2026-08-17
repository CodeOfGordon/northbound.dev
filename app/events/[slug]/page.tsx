import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Building2, CalendarDays, Clock, Globe, MapPin, Plane, Send, Ticket } from 'lucide-react';
import EventImage from '@/components/EventImage';
import AddToCalendar from '@/components/AddToCalendar';
import RegisterButton from '@/components/RegisterButton';
import EventGrid from '@/components/EventGrid';
import { CATEGORY_LABELS, HIDDEN_TAGS, LANE_LABELS, laneOf, MODE_LABELS } from '@/lib/constants';
import { formatDate, formatLocation, formatPrice, formatTime, formatVenue, isPlaceholderLoc, siteLogo, timeAgo } from '@/lib/format';
import { applicationSignal, travelSignal } from '@/lib/hackathon';
import { getEventBySlug, getRelatedEvents } from '@/lib/events';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { slug } = await params; // Next 16: params is a Promise
    const event = await getEventBySlug(slug);
    if (!event) return { title: 'Event not found — Northbound' };
    return {
        title: `${event.title} — Northbound`,
        description: event.description.slice(0, 160),
    };
}

/** schema.org Event JSON-LD — earns rich results and makes the feed machine-readable. */
function eventJsonLd(event: NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>) {
    const online = event.mode === 'online';
    return {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: event.title,
        description: event.description,
        startDate: `${event.date}T${event.time}:00`,
        ...(event.endDate ? { endDate: `${event.endDate}T${event.endTime ?? event.time}:00` } : {}),
        eventAttendanceMode: online
            ? 'https://schema.org/OnlineEventAttendanceMode'
            : 'https://schema.org/OfflineEventAttendanceMode',
        location: online
            ? { '@type': 'VirtualLocation', url: event.url }
            : {
                  // Placeholder venue/city/country ('TBA', 'North America') must not
                  // reach structured data — omit unknown parts instead.
                  '@type': 'Place',
                  name: formatVenue(event.venue, event.mode) ?? (isPlaceholderLoc(event.city) ? 'To be announced' : event.city),
                  address: {
                      '@type': 'PostalAddress',
                      ...(isPlaceholderLoc(event.city) ? {} : { addressLocality: event.city }),
                      ...(isPlaceholderLoc(event.country) || /^(online|north america|international)$/i.test(event.country)
                          ? {}
                          : { addressCountry: event.country }),
                  },
              },
        organizer: { '@type': 'Organization', name: event.organizer },
        ...(event.image ? { image: [event.image] } : {}),
        url: event.url,
        ...(event.isFree ? { isAccessibleForFree: true } : {}),
    };
}

const EventPage = async ({ params }: { params: Params }) => {
    const { slug } = await params;
    const event = await getEventBySlug(slug);
    if (!event) notFound();

    const related = await getRelatedEvents(event);
    const tags = event.tags.filter((t) => !HIDDEN_TAGS.includes(t));
    const appSignal = applicationSignal(event);
    const travel = travelSignal(event);

    const chips = [
        event.category && CATEGORY_LABELS[event.category],
        MODE_LABELS[event.mode],
        `${LANE_LABELS[laneOf(event.source, event.category)]} event`,
    ].filter(Boolean) as string[];

    return (
        <section className="flex flex-col gap-14">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd(event)) }}
            />
            <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center gap-2">
                    {chips.map((chip) => (
                        <span key={chip} className="pill">{chip}</span>
                    ))}
                    {formatPrice(event.isFree, event.price).kind === 'free' && <span className="pill text-primary">Free</span>}
                </div>

                <h1 className="text-5xl max-sm:text-3xl">{event.title}</h1>
                <p className="text-light-200 flex items-center gap-2 text-lg max-sm:text-sm">
                    <Building2 className="size-5 shrink-0" aria-hidden /> Hosted by {event.organizer}
                </p>
            </div>

            <div className="flex flex-col items-start gap-12 lg:flex-row">
                <div className="flex w-full flex-[2] flex-col gap-8">
                    {event.image ? (
                        <EventImage src={event.image} alt={event.title} w={1280} className="max-h-[420px] w-full rounded-xl" fill={false} />
                    ) : (
                        <EventImage src="" alt={event.title} fallbackLogo={siteLogo(event.url)} className="h-48 w-full rounded-xl" />
                    )}

                    <div className="flex flex-col gap-3">
                        <h3>About this event</h3>
                        <p className="text-light-100 whitespace-pre-line text-lg max-sm:text-sm">{event.description}</p>
                        {event.overview && <p className="text-light-200 max-sm:text-sm">{event.overview}</p>}
                    </div>

                    {event.agenda && event.agenda.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <h3>Agenda</h3>
                            <ul className="text-light-100 list-inside list-disc">
                                {event.agenda.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => (
                                <span key={tag} className="chip text-light-200">#{tag}</span>
                            ))}
                        </div>
                    )}
                </div>

                <aside className="w-full flex-1 lg:sticky lg:top-24">
                    <div className="bg-dark-100/70 border-border-dark card-shadow flex w-full flex-col gap-5 rounded-xl border px-5 py-6">
                        <div className="text-light-100 flex flex-col gap-3 text-base">
                            <span className="flex items-center gap-3">
                                <CalendarDays className="text-primary size-5 shrink-0" aria-hidden />
                                {formatDate(event.date)}
                                {event.endDate && event.endDate !== event.date ? ` → ${formatDate(event.endDate)}` : ''}
                            </span>
                            <span className="flex items-center gap-3">
                                <Clock className="text-primary size-5 shrink-0" aria-hidden />
                                {formatTime(event.time)}
                                {event.endTime ? ` – ${formatTime(event.endTime)}` : ''}{' '}
                                <span className="text-light-200 text-xs">({event.timezone})</span>
                            </span>
                            <span className="flex items-start gap-3">
                                {event.mode === 'online' ? (
                                    <>
                                        <Globe className="text-primary size-5 shrink-0" aria-hidden /> Online event
                                    </>
                                ) : (
                                    <>
                                        <MapPin className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                                        {(() => {
                                            const venue = formatVenue(event.venue, event.mode);
                                            const loc = formatLocation(event);
                                            if (!venue && !loc) return <span className="text-light-200">Location TBA</span>;
                                            return (
                                                <span>
                                                    {venue ?? <span className="text-light-200">Venue TBA</span>}
                                                    {loc && <span className="text-light-200 block text-sm">{loc}</span>}
                                                </span>
                                            );
                                        })()}
                                    </>
                                )}
                            </span>
                            {(() => {
                                const priceInfo = formatPrice(event.isFree, event.price);
                                return (
                                    <span className="flex items-center gap-3">
                                        <Ticket className="text-primary size-5 shrink-0" aria-hidden />
                                        {priceInfo.kind === 'unknown'
                                            ? <span className="text-light-200">Price not listed</span>
                                            : priceInfo.label}
                                    </span>
                                );
                            })()}
                            {appSignal.status !== 'unknown' && (
                                <span className="flex items-center gap-3">
                                    <Send className="text-primary size-5 shrink-0" aria-hidden />
                                    <span>
                                        {appSignal.status === 'open' && 'Applications open'}
                                        {appSignal.status === 'closed' && 'Applications closed'}
                                        {appSignal.status === 'not_yet' && 'Applications open soon'}
                                        {appSignal.status === 'open' && appSignal.deadline && (
                                            <span className="text-light-200 block text-sm">
                                                apply by {formatDate(appSignal.deadline)}
                                            </span>
                                        )}
                                    </span>
                                </span>
                            )}
                        </div>

                        {travel && (
                            <div className="border-border-dark flex flex-col gap-1.5 border-t pt-4">
                                <span className="text-light-100 flex items-start gap-3 text-base">
                                    <Plane className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                                    <span>
                                        {travel.status === 'yes' &&
                                            `Travel reimbursement offered${travel.amount ? ` · ${travel.amount}` : ''}`}
                                        {travel.status === 'no' && 'No travel reimbursement'}
                                        {travel.status === 'unknown' && (
                                            <span className="text-light-200">Travel support not listed — check the event site</span>
                                        )}
                                    </span>
                                </span>
                                {travel.evidence && (
                                    <p className="text-light-200 line-clamp-3 pl-8 text-xs">“{travel.evidence}”</p>
                                )}
                                {travel.checkedAt && (
                                    <p className="label pl-8 normal-case">
                                        checked {timeAgo(travel.checkedAt)} · {travel.curated ? 'curated' : 'from the event site'}
                                    </p>
                                )}
                            </div>
                        )}

                        <RegisterButton event={event} />
                        <AddToCalendar event={event} />
                    </div>
                </aside>
            </div>

            {related.length > 0 && (
                <div className="flex flex-col gap-5">
                    <h3>You might also like</h3>
                    <EventGrid events={related} />
                </div>
            )}
        </section>
    );
};

export default EventPage;
