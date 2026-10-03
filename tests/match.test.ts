/** Digest interest matching after the lead-time filter's removal (ADR-029). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEvent, rulesForSubscriber, type EventLike } from '@/lib/notify/match';

const hack = (over: Partial<EventLike> = {}): EventLike => ({
    title: 'HackPrinceton',
    description: 'Princeton hackathon',
    date: '2026-11-13',
    city: 'Princeton',
    tags: ['hackathon'],
    source: 'watchlist',
    category: 'hackathon',
    region: 'US',
    mode: 'offline',
    ...over,
});

const prefs = { topics: ['hackathon'], regions: ['CA', 'US'], usTravelOnly: false };

test('no lead-time gate: a hackathon starting in 3 days still matches while applications are open', () => {
    const rules = rulesForSubscriber(prefs);
    assert.deepEqual(matchEvent(hack({ date: '2026-10-06' }), rules), ['Hackathons · United States']);
});

test('hackathon rules reject events whose applications are closed for this subscriber', () => {
    const rules = rulesForSubscriber(prefs);
    assert.deepEqual(matchEvent(hack(), rules, { applicationsClosed: true }), []);
    assert.equal(matchEvent(hack(), rules, { applicationsClosed: false }).length, 1);
});

test('non-hackathon topics are not gated on application state', () => {
    const rules = rulesForSubscriber({ topics: ['community'], regions: ['CA'], usTravelOnly: false });
    const meetup = hack({ category: 'meetup', region: 'CA', city: 'Toronto', source: 'luma' });
    assert.equal(matchEvent(meetup, rules, { applicationsClosed: true }).length, 1);
});

test('US travel-only scoping still requires a confirmed travel policy', () => {
    const rules = rulesForSubscriber({ ...prefs, usTravelOnly: true });
    assert.deepEqual(matchEvent(hack(), rules), []);
    assert.deepEqual(matchEvent(hack({ enrichment: { travel: { status: 'yes' } } }), rules), ['Hackathons · United States (travel covered)']);
    assert.deepEqual(matchEvent(hack({ region: 'CA', city: 'Toronto' }), rules), ['Hackathons · Canada']);
});
