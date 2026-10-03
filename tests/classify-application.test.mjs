/**
 * Classifier fixtures for scripts/lib/classify-application.mjs (ADR-029).
 * Strings are real-world phrasings from hackathon sites (2025–26 editions) —
 * every one of the deadline strings here was missed by the old month-name-only
 * regex, and the mentor/CTA cases produced false "open" results.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyApplication,
    classifyPortal,
    classifyTravel,
    curatedDeadlines,
    extractDeadlines,
    findApplyLinks,
    mergeApplication,
    overrideFor,
    pageText,
    recheckHours,
    urgencyKey,
} from '../scripts/lib/classify-application.mjs';

const tiers = (ds) => ds.map((d) => [d.kind, d.date, d.time ?? null, d.tz ?? null, d.audience]);

test('Cal Hacks 13.0: numeric dates with paired tiers across a domain name', () => {
    const r = classifyApplication('Cal Hacks 13.0 . Apply at hive.hackberkeley.org by 9/13 (priority) / 9/20 (regular). October 23–25, 2026', '2026-10-23');
    assert.deepEqual(tiers(r.deadlines), [
        ['priority', '2026-09-13', null, null, 'all'],
        ['regular', '2026-09-20', null, null, 'all'],
    ]);
});

test('times and zone abbreviations, DST-agnostic zones', () => {
    assert.deepEqual(tiers(extractDeadlines('Apply by July 4th 11:59PM ET!', '2026-09-19')), [['regular', '2026-07-04', '23:59', 'America/New_York', 'all']]);
    assert.deepEqual(tiers(extractDeadlines('Hacker applications close Nov 2, 11:59 PM PT', '2027-02-12')), [['regular', '2026-11-02', '23:59', 'America/Los_Angeles', 'all']]);
    assert.deepEqual(tiers(extractDeadlines('Applications due Sept 20 at 11:59 PM AoE', '2026-10-23')), [['regular', '2026-09-20', '23:59', 'Etc/GMT+12', 'all']]);
});

test('early vs regular rounds with weekday prefixes (MHacks 2026)', () => {
    const ds = extractDeadlines('Early Applications due Fri Aug 7, 11:59 PM ET. Regular Applications due Sat Sept 12', '2026-10-03');
    assert.deepEqual(tiers(ds), [
        ['priority', '2026-08-07', '23:59', 'America/New_York', 'all'],
        ['regular', '2026-09-12', null, null, 'all'],
    ]);
});

test('nearest tier word wins when two tiers share a sentence', () => {
    const ds = extractDeadlines('Priority deadline is Sep 13 and the regular deadline is Sep 20.', '2026-10-23');
    assert.deepEqual(ds.map((d) => [d.kind, d.date]), [['priority', '2026-09-13'], ['regular', '2026-09-20']]);
});

test('extensions replace the earlier date and record it', () => {
    const ds = extractDeadlines('Applications close September 18. Update: the deadline has been extended until September 25th at 11:59pm!', '2026-10-03');
    assert.equal(ds.length, 1);
    assert.equal(ds[0].date, '2026-09-25');
    assert.equal(ds[0].extendedFrom, '2026-09-18');
});

test('a stated weekday picks the right year; a past edition\'s date is dropped', () => {
    // PennApps XXVI (Sep 2025): "extended until Monday, August 18th" — a Monday in 2025.
    assert.equal(extractDeadlines('Applications have been extended until Monday, August 18th', '2025-09-05')[0].date, '2025-08-18');
    // Same stale text still on the page a year later: Aug 18 2026 is a Tuesday, the
    // weekday points at 2025, and a deadline 400+ days before the event is old copy.
    assert.deepEqual(extractDeadlines('Applications have been extended until Monday, August 18th', '2026-09-30'), []);
});

test('restricted tiers carry who they are for', () => {
    const ds = extractDeadlines('Priority deadline Oct 19 (Stanford students only). Regular deadline Nov 1.', '2027-02-12');
    const p = ds.find((d) => d.kind === 'priority');
    assert.equal(p.audience, 'restricted');
    assert.match(p.audienceNote, /Stanford students only/);
    assert.equal(ds.find((d) => d.kind === 'regular').audience, 'all');
});

test('not deadlines: event date ranges, room numbers, project submissions, dates after the event', () => {
    assert.deepEqual(extractDeadlines('Register now for October 23–25 in San Francisco', '2026-10-23'), []);
    assert.deepEqual(extractDeadlines('Workshops in Rooms 3/4 at 2pm. Hacking ends Oct 25', '2026-10-23'), []);
    assert.deepEqual(extractDeadlines('Project submissions due Oct 25 at 9 AM', '2026-10-23'), []);
    assert.deepEqual(extractDeadlines('Applications for next year open by Dec 1', '2026-10-23'), []);
});

test('only hacker applications count: mentor/volunteer statements and bare CTAs are not "open"', () => {
    const mentor = classifyApplication('Mentor applications are open! Apply now to be a mentor.', '2026-11-13');
    assert.equal(mentor.status, 'unknown');
    const cta = classifyApplication('Cal Hacks 13.0 . Apply now', '2026-10-23');
    assert.equal(cta.status, 'unknown');
    assert.equal(cta.ctaSeen, true);
    const hacker = classifyApplication('Hacker applications are now open!', '2026-11-13');
    assert.equal(hacker.status, 'open');
});

test('closed statements: version numbers, waitlists, and last year\'s text ignored', () => {
    assert.equal(classifyApplication('Applications for Cal Hacks 13.0 have closed. Thanks!', '2026-10-23').status, 'closed');
    const wl = classifyApplication("We've reached capacity — join the waitlist", '2026-10-23');
    assert.equal(wl.status, 'closed');
    assert.equal(wl.waitlist, true);
    const past = classifyApplication('Applications for HackX 2025 are closed. Applications are now open for HackX 2026!', '2026-11-13');
    assert.equal(past.status, 'open');
});

test('not yet open', () => {
    assert.equal(classifyApplication('Applications open in October — stay tuned!', '2027-01-20').status, 'not_yet');
    assert.equal(classifyApplication('Sign up to be notified when applications open.', '2027-01-20').status, 'not_yet');
});

test('portals: closed markers decide; a sign-in wall is unknown, never open', () => {
    assert.equal(classifyPortal('This form is no longer accepting responses. Try contacting the owner', '2026-10-23').status, 'closed');
    assert.equal(classifyPortal('This typeform is now closed', '2026-10-23').status, 'closed');
    assert.equal(classifyPortal('Registration closed. This event is full', '2026-10-23').status, 'closed');
    const wall = classifyPortal('Sign in with GitHub to continue to the hacker portal', '2026-10-23');
    assert.equal(wall.status, 'unknown');
    assert.equal(wall.signIn, true);
});

test('apply links: follow the page\'s own (cross-host) hacker portal, skip mentor and social links', () => {
    const html = `
        <a href="https://instagram.com/calhacks">Instagram</a>
        <a href="https://forms.gle/mentor123">Apply to be a mentor</a>
        <a class="btn" href="https://hive.hackberkeley.org/apply">Apply now</a>
        <a href="/schedule">Schedule</a>`;
    assert.deepEqual(findApplyLinks(html, 'https://www.calhacks.io/'), ['https://hive.hackberkeley.org/apply']);
});

test('pageText separates blocks so a heading never fuses with the next sentence', () => {
    const t = pageText('<h2>Applications</h2><p>Mentors: sign up below</p><button>Apply now</button>');
    assert.match(t, /Applications \. Mentors/);
});

test('override lookup: exact host, year subdomains only — no blanket parent-domain fallback', () => {
    const overrides = { 'hack.gt': { travel: { status: 'yes' } }, 'knighthacks.org': { travel: { status: 'no' } } };
    assert.equal(overrideFor(overrides, 'sprout.hack.gt'), undefined);
    assert.equal(overrideFor(overrides, '2026.knighthacks.org').travel.status, 'no');
    assert.equal(overrideFor(overrides, 'hack.gt').travel.status, 'yes');
});

test('curated deadlines are pinned to one edition (±3 days of its start)', () => {
    const ov = { editions: [{ eventStart: '2026-10-23', deadlines: [{ kind: 'regular', date: '2026-09-20' }] }] };
    assert.equal(curatedDeadlines(ov, '2026-10-24').length, 1);
    assert.equal(curatedDeadlines(ov, '2027-10-22').length, 0);
    assert.equal(curatedDeadlines(ov, '2026-10-24')[0].source, 'curated');
});

test('mergeApplication carries observations forward, never writes undefined, curated wins', () => {
    const prev = { checkedAt: '2026-09-01T00:00:00.000Z', application: { status: 'open' } };
    const read = { status: 'unknown', deadlines: [{ kind: 'regular', date: '2026-09-27', audience: 'all', source: 'site' }] };
    const curated = [{ kind: 'regular', date: '2026-09-20', audience: 'all', source: 'curated' }];
    const m = mergeApplication(prev, read, curated, '2026-09-10T00:00:00.000Z');
    assert.equal(m.openSeenAt, '2026-09-01T00:00:00.000Z'); // legacy fallback from checkedAt
    assert.equal(m.closedSeenAt, undefined);
    assert.ok(!Object.values(m).some((v) => v === undefined));
    assert.deepEqual(m.deadlines.map((d) => d.date), ['2026-09-20']);
    assert.equal(m.deadline, '2026-09-20');
    const closed = mergeApplication({ application: m }, { status: 'closed', deadlines: [] }, [], '2026-09-21T00:00:00.000Z');
    assert.equal(closed.closedSeenAt, '2026-09-21T00:00:00.000Z');
    assert.equal(closed.openSeenAt, '2026-09-01T00:00:00.000Z');
});

test('recheck cadence follows application state', () => {
    const today = '2026-09-15';
    const e = (application, extra = {}) => ({ checkedAt: '2026-09-14T00:00:00.000Z', fetchStatus: 'ok', application, ...extra });
    assert.equal(recheckHours(undefined, today), 0);
    assert.equal(recheckHours(e({ status: 'open', deadlines: [{ date: '2026-09-20' }] }), today), 24);
    assert.equal(recheckHours(e({ status: 'open', deadlines: [{ date: '2026-10-20' }] }), today), 72);
    assert.equal(recheckHours(e({ status: 'open' }), today), 24);
    assert.equal(recheckHours(e({ status: 'not_yet' }), today), 48);
    assert.equal(recheckHours(e({ status: 'closed' }), today), 168);
    assert.equal(recheckHours(e({ status: 'closed', deadlines: [{ date: '2026-09-14' }] }), today), 12); // day-after check
    assert.equal(recheckHours(e({ status: 'open' }, { fetchStatus: 'fetch_failed' }), today), 168);
});

test('urgency ordering puts the nearest deadline first', () => {
    const today = '2026-09-15';
    const soon = [{ date: '2026-11-13', enrichment: { application: { status: 'unknown', deadlines: [{ date: '2026-09-16' }] } } }];
    const later = [{ date: '2026-10-01', enrichment: { application: { status: 'open', deadlines: [{ date: '2026-09-25' }] } } }];
    const none = [{ date: '2026-09-20', enrichment: { application: { status: 'unknown' } } }];
    const sorted = [none, later, soon].sort((a, b) => urgencyKey(a, today).localeCompare(urgencyKey(b, today)));
    assert.deepEqual(sorted, [soon, later, none]);
});

test('travel classifier regressions (ADR-020/027/028 phrasings)', () => {
    assert.equal(classifyTravel('We will not be providing any travel reimbursements this year.').status, 'no');
    assert.equal(classifyTravel("Unfortunately we aren't able to offer travel reimbursement.").status, 'no');
    assert.equal(classifyTravel('Travel reimbursements are available for hackers from out of state.').status, 'yes');
    assert.equal(classifyTravel('Is reimbursement offered for travel expenses?').status, 'unknown');
    assert.equal(classifyTravel('Join us for 36 hours of hacking').status, 'unknown');
});
