/**
 * Characterization tests for the read-time application resolver
 * (lib/hackathon.ts, ADR-029). Scenarios are the real misses that motivated
 * it: Cal Hacks 13.0 shown "open" after its Sep 20 close, HackPrinceton's
 * Sep 28 deadline never surfaced, and priority vs regular for applicants
 * travelling in from another country.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applicationBadge,
    applicationState,
    deadlinePhrase,
    dueLabel,
    dueWhen,
    parseApplicant,
    zonedInstant,
    type Applicant,
} from '@/lib/hackathon';
import type { AppDeadline } from '@/database';
import type { EventDoc } from '@/lib/events';

const CA: Applicant = { country: 'CA', wantsTravel: false };
const US: Applicant = { country: 'US', wantsTravel: false };

function event(over: Partial<EventDoc> = {}): EventDoc {
    return {
        title: 'Test Hackathon',
        slug: 'test-hackathon',
        description: '',
        image: '',
        venue: '',
        country: 'United States',
        city: 'San Francisco',
        date: '2026-10-23',
        time: '09:00',
        timezone: 'America/Los_Angeles',
        mode: 'offline',
        organizer: 'Test',
        tags: ['hackathon'],
        url: 'https://example.org/',
        source: 'watchlist',
        category: 'hackathon',
        region: 'US',
        ...over,
    };
}

function withDeadlines(deadlines: AppDeadline[], app: Record<string, unknown> = {}, over: Partial<EventDoc> = {}): EventDoc {
    return event({
        enrichment: {
            host: 'example.org',
            checkedAt: '2026-09-01T12:00:00.000Z',
            source: 'site',
            fetchStatus: 'ok',
            application: { status: 'unknown', deadlines, ...app },
            travel: { status: 'unknown' },
        },
        ...over,
    });
}

const CAL_HACKS: AppDeadline[] = [
    { kind: 'priority', date: '2026-09-13', audience: 'all', source: 'curated' },
    { kind: 'regular', date: '2026-09-20', audience: 'all', source: 'curated' },
];

test('Cal Hacks: closed the day after the regular deadline, even with a lingering "open" observation', () => {
    const e = withDeadlines(CAL_HACKS, { status: 'open', openSeenAt: '2026-09-21T10:00:00.000Z' });
    const s = applicationState(e, CA, new Date('2026-09-21T16:00:00Z'));
    assert.equal(s.status, 'closed');
    assert.equal(applicationBadge(s)?.text, 'Apps closed');
});

test('applicant travelling in from abroad: the priority tier is the act-by date', () => {
    const e = withDeadlines(CAL_HACKS);
    const s = applicationState(e, CA, new Date('2026-09-10T16:00:00Z'));
    assert.equal(s.abroad, true);
    assert.equal(s.actBy?.kind, 'priority');
    assert.equal(s.actByReason, 'abroad');
    assert.equal(s.hardDeadline?.date, '2026-09-20');
    assert.equal(s.status, 'closing_soon'); // 3 days to the priority date
    assert.match(deadlinePhrase(s)!, /Apply by Sep 13 \(priority\).*recommended.*regular Sep 20/);
});

test('local applicant: the regular tier is the act-by date, priority shown as early decision', () => {
    const s = applicationState(withDeadlines(CAL_HACKS), US, new Date('2026-09-10T16:00:00Z'));
    assert.equal(s.abroad, false);
    assert.equal(s.actBy?.kind, 'regular');
    assert.equal(s.actByReason, undefined);
    assert.equal(s.status, 'open'); // 10 days out — not yet "closing soon"
    assert.match(deadlinePhrase(s)!, /priority Sep 13 for an early decision/);
});

test('needing travel money also makes the priority tier the act-by date for a local applicant', () => {
    const s = applicationState(withDeadlines(CAL_HACKS), { country: 'US', wantsTravel: true }, new Date('2026-09-10T16:00:00Z'));
    assert.equal(s.actBy?.kind, 'priority');
    assert.equal(s.actByReason, 'travel');
});

test('priority passed, regular still open: still open, falls back to the regular tier', () => {
    const s = applicationState(withDeadlines(CAL_HACKS), CA, new Date('2026-09-15T16:00:00Z'));
    assert.equal(s.status, 'closing_soon');
    assert.equal(s.actBy?.kind, 'regular');
    assert.deepEqual(s.passed.map((d) => d.kind), ['priority']);
    assert.match(deadlinePhrase(s)!, /priority passed/);
});

test('HackPrinceton: a deadline today reads "Closes today" and stays open until 23:59 in its own zone', () => {
    const e = withDeadlines(
        [{ kind: 'regular', date: '2026-09-28', tz: 'America/New_York', audience: 'all', source: 'curated' }],
        {},
        { date: '2026-11-13', timezone: 'America/New_York', city: 'Princeton' },
    );
    const afternoon = applicationState(e, CA, new Date('2026-09-28T20:00:00Z'));
    assert.equal(afternoon.status, 'closing_soon');
    assert.equal(dueLabel(afternoon.actBy!), 'Closes today');
    const lateEvening = applicationState(e, CA, new Date('2026-09-29T03:30:00Z')); // 23:30 EDT
    assert.equal(lateEvening.status, 'closing_soon');
    const after = applicationState(e, CA, new Date('2026-09-29T04:05:00Z')); // 00:05 EDT Sep 29
    assert.equal(after.status, 'closed');
});

test('a PT deadline is still open after Toronto midnight', () => {
    const e = withDeadlines([{ kind: 'regular', date: '2026-11-02', time: '23:59', tz: 'America/Los_Angeles', audience: 'all', source: 'site' }], {}, { date: '2027-02-12' });
    const s = applicationState(e, CA, new Date('2026-11-03T05:30:00Z')); // 00:30 Toronto, 21:30 PT
    assert.equal(s.status, 'closing_soon');
    assert.equal(s.actBy?.daysLeft, 0);
    assert.equal(dueWhen(s.actBy!), 'Nov 2, 11:59 PM PST');
});

test('zonedInstant honours DST on both sides of the change', () => {
    assert.equal(zonedInstant('2026-07-04', '23:59', 'America/New_York').toISOString(), '2026-07-05T03:59:00.000Z');
    assert.equal(zonedInstant('2026-11-02', '23:59', 'America/Los_Angeles').toISOString(), '2026-11-03T07:59:00.000Z');
    assert.equal(zonedInstant('2026-09-20', '23:59', 'Etc/GMT+12').toISOString(), '2026-09-21T11:59:00.000Z');
});

test('P3: an old "open" observation with no deadline is stale, a fresh one is verified', () => {
    const now = new Date('2026-10-03T16:00:00Z');
    const stale = applicationState(withDeadlines([], { status: 'open', openSeenAt: '2026-09-20T10:00:00.000Z' }), CA, now);
    assert.equal(stale.status, 'open');
    assert.equal(stale.confidence, 'stale');
    assert.equal(applicationBadge(stale)?.text, 'Apps open?');
    const fresh = applicationState(withDeadlines([], { status: 'open', openSeenAt: '2026-10-03T06:00:00.000Z' }), CA, now);
    assert.equal(fresh.confidence, 'verified');
    assert.equal(applicationBadge(fresh)?.text, 'Apps open');
});

test('a newer "closed" observation beats an older "open", even with a future deadline', () => {
    const e = withDeadlines(CAL_HACKS, {
        status: 'closed',
        openSeenAt: '2026-09-01T00:00:00.000Z',
        closedSeenAt: '2026-09-05T00:00:00.000Z',
        waitlist: true,
    });
    const s = applicationState(e, US, new Date('2026-09-06T00:00:00Z'));
    assert.equal(s.status, 'closed');
    assert.equal(applicationBadge(s)?.text, 'Waitlist only');
});

test('unknown status + a known future deadline resolves to open (backed by the deadline)', () => {
    const s = applicationState(withDeadlines(CAL_HACKS), US, new Date('2026-09-01T16:00:00Z'));
    assert.equal(s.status, 'open');
    assert.equal(s.confidence, 'deadline');
});

test('Devpost in-person: submission-window fields are ignored; online keeps them', () => {
    const inPerson = event({
        url: 'https://somehack.devpost.com/',
        source: 'hackathon',
        applicationStatus: 'open',
        applicationDeadline: '2026-10-25',
        updatedAt: '2026-10-03T07:00:00.000Z',
    });
    assert.equal(applicationState(inPerson, CA, new Date('2026-10-03T16:00:00Z')).status, 'unknown');
    const online = { ...inPerson, mode: 'online' as const, region: 'ONLINE' as const };
    const s = applicationState(online, CA, new Date('2026-10-03T16:00:00Z'));
    assert.equal(s.status, 'open');
    assert.equal(s.actBy?.date, '2026-10-25');
});

test('restricted tiers are shown but never become the act-by date', () => {
    const e = withDeadlines(
        [
            { kind: 'priority', date: '2026-10-19', audience: 'restricted', audienceNote: 'Stanford students only', source: 'site' },
            { kind: 'regular', date: '2026-11-01', audience: 'all', source: 'site' },
        ],
        {},
        { date: '2027-02-12' },
    );
    const s = applicationState(e, CA, new Date('2026-10-10T16:00:00Z'));
    assert.equal(s.actBy?.date, '2026-11-01');
    assert.equal(s.restricted.length, 1);
    assert.equal(s.restricted[0].audienceNote, 'Stanford students only');
});

test('an international cut-off is the hard deadline only for applicants from abroad', () => {
    const e = withDeadlines([
        { kind: 'international', date: '2026-09-01', audience: 'international', source: 'site' },
        { kind: 'regular', date: '2026-09-20', audience: 'all', source: 'site' },
    ]);
    const now = new Date('2026-09-05T16:00:00Z');
    assert.equal(applicationState(e, CA, now).status, 'closed');
    assert.equal(applicationState(e, US, now).status, 'open');
});

test('travel-funding tiers apply only when the applicant needs travel support (or comes from abroad)', () => {
    const e = withDeadlines([
        { kind: 'travel', date: '2026-08-12', audience: 'all', source: 'site' },
        { kind: 'regular', date: '2026-09-10', audience: 'all', source: 'site' },
    ], {}, { date: '2026-09-25', city: 'Atlanta' });
    const now = new Date('2026-08-01T16:00:00Z');
    assert.equal(applicationState(e, US, now).actBy?.kind, 'regular');
    assert.equal(applicationState(e, { country: 'US', wantsTravel: true }, now).actBy?.kind, 'travel');
});

test('F6 risk flag: in-person major near its start with no deadline anywhere', () => {
    const now = new Date('2026-10-03T16:00:00Z');
    const near = applicationState(withDeadlines([], {}, { date: '2026-11-13' }), CA, now);
    assert.equal(near.risk, 'deadline-unpublished');
    assert.equal(applicationBadge(near)?.text, 'No deadline');
    const far = applicationState(withDeadlines([], {}, { date: '2027-03-01' }), CA, now);
    assert.equal(far.risk, undefined);
    const notMajor = applicationState(withDeadlines([], {}, { date: '2026-11-13', source: 'mlh' }), CA, now);
    assert.equal(notMajor.risk, undefined);
});

test('legacy enrichment (one undifferentiated deadline + status) still resolves', () => {
    const e = event({
        enrichment: {
            host: 'example.org',
            checkedAt: '2026-09-30T12:00:00.000Z',
            source: 'site',
            fetchStatus: 'ok',
            application: { status: 'open', deadline: '2026-10-10' },
            travel: { status: 'unknown' },
        },
    });
    const s = applicationState(e, CA, new Date('2026-10-03T16:00:00Z'));
    assert.equal(s.status, 'closing_soon');
    assert.equal(s.actBy?.date, '2026-10-10');
    assert.equal(s.verifiedAt, '2026-09-30T12:00:00.000Z');
});

test('curated tiers beat site-read tiers of the same kind', () => {
    const e = withDeadlines([
        { kind: 'regular', date: '2026-09-27', audience: 'all', source: 'site' },
        { kind: 'regular', date: '2026-09-20', audience: 'all', source: 'curated' },
    ]);
    const s = applicationState(e, US, new Date('2026-09-10T16:00:00Z'));
    assert.equal(s.upcoming.length, 1);
    assert.equal(s.actBy?.date, '2026-09-20');
});

test('parseApplicant: cookie wins, then IP country, then Canada', () => {
    assert.deepEqual(parseApplicant('US-1'), { country: 'US', wantsTravel: true });
    assert.deepEqual(parseApplicant(undefined, 'US'), { country: 'US', wantsTravel: false });
    assert.deepEqual(parseApplicant(undefined, 'IN'), { country: 'OTHER', wantsTravel: false });
    assert.deepEqual(parseApplicant('garbage', null), { country: 'CA', wantsTravel: false });
    assert.deepEqual(parseApplicant('OTHER-0', 'US'), { country: 'OTHER', wantsTravel: false });
});
