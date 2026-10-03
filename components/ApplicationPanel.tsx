import { Send } from 'lucide-react';
import AddDeadlineToCalendar from '@/components/AddDeadlineToCalendar';
import ApplicantToggle from '@/components/ApplicantToggle';
import {
    KIND_LABEL,
    RISK_NOTE,
    dueLabel,
    dueWhen,
    staleNote,
    stateOf,
    type Applicant,
    type Due,
} from '@/lib/hackathon';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
    applicant: Applicant;
}

const SOURCE_LABEL: Record<Due['source'], string> = {
    site: 'event site',
    curated: 'curated',
    platform: 'Devpost',
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Detail-page application block (ADR-029): status for THIS viewer, every
 * deadline tier with which one is theirs, where each came from and how old the
 * check is, and the deadline as its own calendar entry.
 */
const ApplicationPanel = ({ event, applicant }: Props) => {
    const s = stateOf(event);
    const tiers = [...s.upcoming, ...s.passed].sort((a, b) => a.closesAt.localeCompare(b.closesAt));
    const hasAnything = s.status !== 'unknown' || tiers.length > 0 || s.restricted.length > 0 || !!s.risk;
    if (!hasAnything && event.category !== 'hackathon') return null;

    const headline =
        s.status === 'closing_soon'
            ? `Applications open · ${s.actBy ? dueLabel(s.actBy).toLowerCase() : 'closing soon'}`
            : s.status === 'open'
              ? 'Applications open'
              : s.status === 'closed'
                ? s.waitlist
                    ? 'Applications closed · waitlist only'
                    : 'Applications closed'
                : s.status === 'not_yet'
                  ? 'Applications open soon'
                  : 'Application status unknown';
    const stale = staleNote(s);
    const evidence = s.actBy?.evidence ?? tiers[0]?.evidence ?? event.enrichment?.application?.evidence;
    const portal = event.enrichment?.application?.portal;
    const portalHost = (() => {
        try {
            return portal ? new URL(portal).hostname : undefined;
        } catch {
            return undefined;
        }
    })();

    return (
        <div className="border-border-dark flex flex-col gap-3 border-t pt-4">
            <span className="text-light-100 flex items-start gap-3 text-base">
                <Send className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                <span className={cn(s.status === 'closing_soon' && 'text-primary font-semibold')}>{headline}</span>
            </span>

            {tiers.length > 0 && (
                <ul className="flex list-none flex-col gap-1.5 pl-8 text-sm" aria-label="Application deadlines">
                    {tiers.map((d) => {
                        const passed = s.passed.includes(d);
                        const yours = d === s.actBy;
                        return (
                            <li key={`${d.kind}-${d.date}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <span className={cn(passed ? 'text-light-200 line-through' : 'text-light-100', yours && 'text-primary font-semibold')}>
                                    {cap(KIND_LABEL[d.kind])} · {dueWhen(d)}
                                </span>
                                <span className="text-light-200 text-xs">
                                    {passed
                                        ? 'passed'
                                        : yours
                                          ? s.actByReason
                                              ? 'recommended for you'
                                              : 'your deadline'
                                          : d.kind === 'priority'
                                            ? 'early decision'
                                            : 'also open'}
                                    {d.source !== 'site' && ` · ${SOURCE_LABEL[d.source]}`}
                                </span>
                            </li>
                        );
                    })}
                    {s.restricted.map((d) => (
                        <li key={`r-${d.kind}-${d.date}`} className="text-light-200 flex flex-wrap items-baseline justify-between gap-x-3">
                            <span>
                                {cap(KIND_LABEL[d.kind])} · {dueWhen(d)}
                            </span>
                            <span className="text-xs">restricted — {d.audienceNote ?? 'not open to everyone'}</span>
                        </li>
                    ))}
                </ul>
            )}

            {s.actByReason === 'abroad' && s.actBy?.kind === 'priority' && (
                <p className="text-light-200 pl-8 text-xs">
                    You&apos;d be travelling in from another country: the priority round&apos;s early decision leaves time to arrange travel
                    (and a visa, if you need one), and travel funding often goes to early applicants.
                </p>
            )}
            {stale && <p className="text-light-200 pl-8 text-xs">{stale}</p>}
            {s.risk && <p className="text-light-200 pl-8 text-xs">{RISK_NOTE}</p>}
            {evidence && <p className="text-light-200 line-clamp-3 pl-8 text-xs">“{evidence}”</p>}

            <p className="label pl-8 normal-case">
                {s.checkedAt ? `checked ${timeAgo(s.checkedAt)}` : 'not checked yet'}
                {portalHost ? ` · read from ${portalHost}` : ''} ·{' '}
                <a href={event.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline underline-offset-2">
                    confirm on the official site
                </a>
            </p>

            {event.category === 'hackathon' && <ApplicantToggle applicant={applicant} className="pl-8" />}

            {s.actBy && s.status !== 'closed' && (
                <div className="pl-8">
                    <AddDeadlineToCalendar slug={event.slug} title={event.title} url={event.url} due={s.actBy} />
                </div>
            )}
        </div>
    );
};

export default ApplicationPanel;
