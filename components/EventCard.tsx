'use client';

import Link from 'next/link';
import Image from 'next/image';
import posthog from 'posthog-js';

interface Props {
    title: string, 
    image: string, 
    slug: string, 
    organization: string, 
    country: string, 
    city: string, 
    date: string, 
    time: string
}

const EventCard = ({ title, image, slug, organization, country, city, date, time }: Props) => {
    return (
        <Link href='/events/${slug}' id='event-card' onClick={() => posthog.capture('event_card_clicked', { title, slug, organization, city, country, date, time })}>
            <Image src={image} alt={title} width={410} height={300} className="poster" />

            <div className='flex flex-row gap-2'>
                <Image src='/icons/pin.svg' alt='location' width={14} height={14} />
                <p>{country}, {city}</p>
            </div>

            <p className='title'>{title}</p>

            <div className='datetime'>
                <div>
                    <Image src='/icons/calendar.svg' alt='date' width={14} height={14} />
                    <p>{date}</p>
                </div>
                <div>
                    <Image src='/icons/clock.svg' alt='time' width={14} height={14} />
                    <p>{time}</p>
                </div>
            </div>
        </Link>

    );
}
export default EventCard;