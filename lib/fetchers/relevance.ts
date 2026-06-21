/**
 * Keyword gate for the broad platform feeds (Luma city pages, Eventbrite, Meetup) —
 * keeps tech/AI/data/dev/networking events and hackathons, drops the yoga classes.
 * Curated sources (MLH, company registry) skip this filter.
 */

const INCLUDE =
    /\b(ai|artificial intelligence|machine[- ]learning|deep[- ]learning|neural|llms?|gen[- ]?ai|generative|agentic|data (science|scientist|engineer(ing)?|platform|infra(structure)?)|mlops|devops|developers?|software|engineer(ing|s)?|programm(ing|ers?)|coding|code|hackathon|hack[- ]?(night|fest|day|week(end)?)|javascript|typescript|python|golang|rust|react|node(\.js)?|cloud|aws|azure|gcp|google cloud|kubernetes|docker|serverless|apis?|frontend|front[- ]end|backend|back[- ]end|full[- ]?stack|web dev(elopment)?|cyber ?security|infosec|appsec|blockchain|web3|robotics|iot|quantum|startups?|founders?|venture|demo (day|night)|product manage(ment|rs?)|fintech|saas|open[- ]?source|big data|analytics|gpu|computer vision|nlp|prompt engineering|tech|technology)\b/i;

const EXCLUDE =
    /\b(yoga|meditation|breathwork|real estate|dating|singles|matchmaking|speed friending|salsa|bachata|zumba|karaoke|paint night|pottery|cooking class|wine tasting|brunch club|book club|astrology|tarot|mlm|multi[- ]level marketing|get rich|forex)\b/i;

export function isRelevant(text: string): boolean {
    return INCLUDE.test(text) && !EXCLUDE.test(text);
}

/**
 * Consumer/retail events that leak in from big-brand company feeds (Tesla runs
 * store celebrations, test drives, holiday events on the same feed as anything
 * technical). These are noise for a dev-events product — dropped for `company`.
 */
const CONSUMER_EXCLUDE =
    /\b(father'?s day|mother'?s day|valentine|test drive|demo drive|ride[- ]?along|delivery (event|day)|trade[- ]?in|owners?'? (event|night|appreciation|day)|sales? event|holiday (sale|party|event|celebration)|black friday|cyber monday|grand opening|store (opening|event|celebration)|family day|easter|halloween|thanksgiving|christmas|new year|vip night|customer appreciation|open house)\b/i;

export function isConsumerEvent(text: string): boolean {
    return CONSUMER_EXCLUDE.test(text);
}

const TAG_PATTERNS: [string, RegExp][] = [
    ['ai', /\b(ai|artificial intelligence|machine[- ]learning|deep[- ]learning|llms?|gen[- ]?ai|generative|agentic|nlp|computer vision|neural)\b/i],
    ['data', /\b(data|analytics|big data|etl|warehouse|database)\b/i],
    ['cloud', /\b(cloud|aws|azure|gcp|kubernetes|docker|serverless|devops)\b/i],
    ['web', /\b(javascript|typescript|react|node|frontend|backend|full[- ]?stack|web dev)\b/i],
    ['security', /\b(security|infosec|appsec|cyber)\b/i],
    ['blockchain', /\b(blockchain|web3|crypto)\b/i],
    ['hackathon', /\b(hackathon|hack[- ]?(night|fest|day|week(end)?))\b/i],
    ['networking', /\b(networking|mixer|social|meetup|drinks|happy hour|breakfast)\b/i],
    ['startup', /\b(startups?|founders?|venture|pitch|demo (day|night))\b/i],
    ['career', /\b(career|hiring|recruit)\b/i],
];

/** Always includes 'tech' so the schema's at-least-one-tag rule holds. */
export function deriveTags(text: string): string[] {
    const tags = TAG_PATTERNS.filter(([, re]) => re.test(text)).map(([tag]) => tag);
    return ['tech', ...tags];
}
