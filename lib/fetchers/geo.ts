/**
 * Self-contained geography classifier + title cleaner for the events aggregator.
 *
 * The scrape pipeline yields loosely-structured location strings ('San Francisco,
 * CA, USA', 'Bengaluru', 'Online'). `classifyRegion` distills those into a coarse
 * {@link Region} so the feed can filter to a Canada+US focus, and `cleanTitle`
 * gently repairs scraped titles without mangling well-formed ones.
 *
 * No external dependencies — diacritics are stripped with `String.normalize`.
 *
 * NOTE on 'london' ambiguity: a bare 'London' resolves to the United Kingdom
 * (INTL). Only an explicit Ontario qualifier ('London, ON' / 'London, Ontario')
 * makes it the Canadian city. This keeps the common case (UK) correct while still
 * honouring the disambiguated Canadian form. See the Canadian-province branch.
 */

/** Coarse region bucket used by the feed filters. */
export type Region = 'CA' | 'US' | 'ONLINE' | 'INTL' | 'UNKNOWN';

/** Result of classifying a raw location into a region + display country. */
export interface GeoResult {
    /** Human-readable country (or 'Online' / 'North America' / 'International' / 'TBA'). */
    country: string;
    /** Coarse region bucket. */
    region: Region;
    /** Whether the event counts as North America (Canada + US focus). `region !== 'INTL'`. */
    isNorthAmerica: boolean;
}

/** Input accepted by {@link classifyRegion}. All fields optional. */
interface ClassifyInput {
    city?: string;
    country?: string;
    venue?: string;
    online?: boolean;
    regions?: string[];
}

/** Tokens that, when seen as a whole location field, mean the event is virtual. */
const ONLINE_TOKENS = new Set(['online', 'virtual', 'webinar', 'digital']);

/** City names that should resolve to "location unknown" rather than a real place. */
const TBA_TOKENS = new Set(['', 'tba', 'tbd', 'hybrid event']);

/**
 * Strip accents and lowercase a string. Used to normalize city keys so 'München'
 * and 'munchen' both match the curated lookup.
 */
function fold(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/** The segment before the first comma (the "city" part of 'City, Region, Country'). */
function firstSegment(value: string): string {
    const comma = value.indexOf(',');
    return (comma === -1 ? value : value.slice(0, comma)).trim();
}

/**
 * True if any region token references North America / the US / Canada / a global
 * audience. Used to decide `isNorthAmerica` for ONLINE and UNKNOWN events.
 */
function regionsIncludeNorthAmerica(regions: string[]): boolean {
    const pattern = /north america|americas|\bnorth\b|\bus\b|u\.s\.|usa|united states|canada|global|worldwide/i;
    return regions.some((token) => pattern.test(token));
}

/** US state postal codes (50 states + DC). */
const US_STATE_CODES = new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC',
]);

/** Full US state names (lowercased). */
const US_STATE_NAMES = new Set([
    'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
    'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
    'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
    'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
    'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
    'new hampshire', 'new jersey', 'new mexico', 'new york',
    'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
    'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
    'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
    'west virginia', 'wisconsin', 'wyoming',
    'district of columbia',
]);

/** Canadian province postal codes. */
const CA_PROVINCE_CODES = new Set([
    'ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'NU', 'YT',
]);

/** Canadian province names (lowercased, accent-folded). */
const CA_PROVINCE_NAMES = new Set([
    'ontario', 'quebec', 'british columbia', 'alberta', 'manitoba',
    'saskatchewan', 'nova scotia', 'new brunswick', 'newfoundland and labrador',
    'newfoundland', 'prince edward island', 'northwest territories', 'nunavut',
    'yukon',
]);

/**
 * Explicit country names / abbreviations recognized inside a location string,
 * mapped to a canonical display name. USA / Canada are special-cased to CA/US
 * regions; everything else is INTL with this display country.
 */
const COUNTRY_ALIASES: { match: RegExp; country: string }[] = [
    { match: /\b(united states|usa|u\.s\.a\.|u\.s\.)\b/i, country: 'USA' },
    { match: /\bcanada\b/i, country: 'Canada' },
    { match: /\b(united kingdom|u\.k\.|uk)\b/i, country: 'United Kingdom' },
    { match: /\bnetherlands\b/i, country: 'Netherlands' },
    { match: /\bgermany\b/i, country: 'Germany' },
    { match: /\bswitzerland\b/i, country: 'Switzerland' },
    { match: /\bfrance\b/i, country: 'France' },
    { match: /\bspain\b/i, country: 'Spain' },
    { match: /\bsweden\b/i, country: 'Sweden' },
    { match: /\baustralia\b/i, country: 'Australia' },
    { match: /\bindia\b/i, country: 'India' },
    { match: /\bbrazil\b/i, country: 'Brazil' },
    { match: /\bnepal\b/i, country: 'Nepal' },
    { match: /\btaiwan\b/i, country: 'Taiwan' },
    { match: /\b(south korea|korea)\b/i, country: 'South Korea' },
    { match: /\bjapan\b/i, country: 'Japan' },
    { match: /\bsingapore\b/i, country: 'Singapore' },
];

/** Curated city → {country, region} lookup. Keys are accent-folded + lowercased. */
const CITY_LOOKUP: Record<string, { country: string; region: Region }> = {};

/** Register a batch of cities under one country/region. */
function register(cities: string[], country: string, region: Region): void {
    for (const city of cities) {
        CITY_LOOKUP[fold(city)] = { country, region };
    }
}

// ---- Canada -----------------------------------------------------------------
register(
    [
        'toronto', 'mississauga', 'markham', 'vaughan', 'brampton', 'waterloo',
        'kitchener', 'ottawa', 'montreal', 'quebec city', 'vancouver', 'calgary',
        'edmonton', 'winnipeg', 'halifax', 'hamilton', 'oshawa', 'oakville',
        'burlington', 'kingston', 'victoria', 'saskatoon', 'regina', 'windsor',
        'guelph', 'kanata',
    ],
    'Canada',
    'CA',
);

// ---- United States ----------------------------------------------------------
register(
    [
        'san francisco', 'south san francisco', 'san jose', 'santa clara',
        'palo alto', 'mountain view', 'sunnyvale', 'menlo park', 'burlingame',
        'oakland', 'berkeley', 'los angeles', 'long beach', 'san diego',
        'sacramento', 'seattle', 'redmond', 'bellevue', 'portland', 'new york',
        'new york city', 'nyc', 'brooklyn', 'boston', 'cambridge', 'chicago',
        'austin', 'dallas', 'houston', 'atlanta', 'miami', 'denver', 'boulder',
        'phoenix', 'las vegas', 'washington', 'washington dc', 'philadelphia',
        'pittsburgh', 'detroit', 'minneapolis', 'nashville', 'raleigh',
        'durham', 'columbus', 'salt lake city', 'san antonio', 'irvine',
        'scottsdale', 'reston', 'mclean', 'arlington',
    ],
    'United States',
    'US',
);

// ---- International (curated, with proper display country) --------------------
register(['london', 'manchester', 'glasgow', 'edinburgh'], 'United Kingdom', 'INTL');
register(['dublin'], 'Ireland', 'INTL');
register(['paris'], 'France', 'INTL');
register(
    ['berlin', 'munich', 'munchen', 'frankfurt', 'frankfurt am main', 'hamburg', 'cologne', 'stuttgart'],
    'Germany',
    'INTL',
);
register(['amsterdam', 'rotterdam'], 'Netherlands', 'INTL');
register(['barcelona', 'madrid'], 'Spain', 'INTL');
register(['lisbon'], 'Portugal', 'INTL');
register(['milan', 'rome'], 'Italy', 'INTL');
register(['zurich', 'geneva', 'davos'], 'Switzerland', 'INTL');
register(['stockholm'], 'Sweden', 'INTL');
register(['oslo'], 'Norway', 'INTL');
register(['copenhagen'], 'Denmark', 'INTL');
register(['helsinki'], 'Finland', 'INTL');
register(['vienna'], 'Austria', 'INTL');
register(['brussels'], 'Belgium', 'INTL');
register(['warsaw'], 'Poland', 'INTL');
register(['prague'], 'Czechia', 'INTL');
register(['dubai'], 'UAE', 'INTL');
register(['tel aviv'], 'Israel', 'INTL');
register(['sao paulo'], 'Brazil', 'INTL');
// Mexico is geographically North America, but the product focuses on Canada+US,
// so Mexican cities are treated as INTL.
register(['mexico city'], 'Mexico', 'INTL');
register(
    [
        'bengaluru', 'bangalore', 'pune', 'ahmedabad', 'mumbai', 'hyderabad',
        'udaipur', 'vallabh v.', 'vallabh vidyanagar', 'new delhi', 'delhi',
        'chennai', 'kolkata', 'gurgaon', 'noida',
    ],
    'India',
    'INTL',
);
register(['butwal', 'kathmandu'], 'Nepal', 'INTL');
register(['changhua', 'taipei'], 'Taiwan', 'INTL');
register(['sydney', 'melbourne', 'brisbane', 'perth'], 'Australia', 'INTL');
register(['auckland'], 'New Zealand', 'INTL');
register(['singapore'], 'Singapore', 'INTL');
register(['tokyo', 'osaka'], 'Japan', 'INTL');
register(['seoul'], 'South Korea', 'INTL');
register(['beijing', 'shanghai', 'shenzhen'], 'China', 'INTL');
register(['hong kong'], 'Hong Kong', 'INTL');
register(['bangkok'], 'Thailand', 'INTL');
register(['jakarta'], 'Indonesia', 'INTL');

/**
 * Build a GeoResult, deriving `isNorthAmerica` from the invariant `region !== 'INTL'`.
 */
function result(country: string, region: Region): GeoResult {
    return { country, region, isNorthAmerica: region !== 'INTL' };
}

/**
 * Classify a raw location into a coarse {@link Region} plus a display country.
 * Precedence (highest first): online → explicit country → US state → Canadian
 * province → curated city lookup → region hints / TBA fallback. See the module
 * doc comment for the 'london' disambiguation rule.
 */
export function classifyRegion(input: ClassifyInput): GeoResult {
    const city = (input.city ?? '').trim();
    const country = (input.country ?? '').trim();
    const venue = (input.venue ?? '').trim();
    const regions = input.regions ?? [];
    const hasRegions = regions.length > 0;

    // 1. ONLINE -------------------------------------------------------------
    const onlineFields = [city, country, venue].map((value) => value.toLowerCase());
    if (input.online === true || onlineFields.some((value) => ONLINE_TOKENS.has(value))) {
        const isNA = hasRegions ? regionsIncludeNorthAmerica(regions) : true;
        return { country: 'Online', region: 'ONLINE', isNorthAmerica: isNA };
    }

    // Combined text used for whole-token country/state/province matching.
    const haystack = [city, country, venue].filter(Boolean).join(', ');

    // 2. Explicit country in the text ---------------------------------------
    for (const alias of COUNTRY_ALIASES) {
        if (alias.match.test(haystack)) {
            if (alias.country === 'USA') return result('United States', 'US');
            if (alias.country === 'Canada') return result('Canada', 'CA');
            return result(alias.country, 'INTL');
        }
    }

    // For state / province / city matching, focus on the city + country fields.
    const segments = haystack
        .split(',')
        .map((segment) => segment.trim())
        .filter(Boolean);

    // 3. US state suffix (postal code or full name) -------------------------
    for (const segment of segments) {
        if (US_STATE_CODES.has(segment.toUpperCase()) || US_STATE_NAMES.has(fold(segment))) {
            return result('United States', 'US');
        }
    }

    // 4. Canadian province (postal code or name), incl. 'London, ON' --------
    for (const segment of segments) {
        if (CA_PROVINCE_CODES.has(segment.toUpperCase()) || CA_PROVINCE_NAMES.has(fold(segment))) {
            return result('Canada', 'CA');
        }
    }

    // 5. Curated city lookup (segment before the first comma) ----------------
    const cityKey = fold(firstSegment(city || country || venue));
    const hit = CITY_LOOKUP[cityKey];
    if (hit) {
        return result(hit.country, hit.region);
    }

    // A trailing segment may itself be a known city, e.g. 'Leicester Square,
    // London' — fall back to the last segment before giving up.
    if (segments.length > 1) {
        const lastKey = fold(segments[segments.length - 1]);
        const lastHit = CITY_LOOKUP[lastKey];
        if (lastHit) {
            return result(lastHit.country, lastHit.region);
        }
    }

    // 6. Unrecognized / TBA — lean on region hints --------------------------
    if (TBA_TOKENS.has(cityKey) || !hit) {
        if (hasRegions) {
            return regionsIncludeNorthAmerica(regions)
                ? { country: 'North America', region: 'UNKNOWN', isNorthAmerica: true }
                : result('International', 'INTL');
        }
        return { country: country || 'TBA', region: 'UNKNOWN', isNorthAmerica: true };
    }

    // Unreachable, but keeps the compiler happy about exhaustiveness.
    return { country: country || 'TBA', region: 'UNKNOWN', isNorthAmerica: true };
}

/** Common HTML entities seen in scraped titles, mapped to their characters. */
const HTML_ENTITIES: Record<string, string> = {
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&#039;': "'",
    '&rsquo;': '’',
    '&lsquo;': '‘',
    '&rdquo;': '”',
    '&ldquo;': '“',
    '&ndash;': '–',
    '&mdash;': '—',
    '&#8211;': '–',
    '&#8212;': '—',
    '&hellip;': '…',
    '&nbsp;': ' ',
    '&lt;': '<',
    '&gt;': '>',
};

/**
 * Conservatively repair a scraped event title:
 *  - decode common HTML entities,
 *  - collapse whitespace runs and trim,
 *  - drop spaces sitting before punctuation (' ,' → ','),
 *  - fix run-together text after a colon ('localhost:bengaluru' →
 *    'localhost: Bengaluru'), inserting a space and capitalizing the next letter.
 *
 * It never otherwise alters capitalization or wording, so already-clean titles
 * pass through untouched.
 */
export function cleanTitle(title: string): string {
    let out = title;

    // Decode HTML entities (longest keys first is unnecessary — keys are distinct).
    out = out.replace(/&[a-zA-Z]+;|&#\d+;/g, (entity) => {
        const lower = entity.toLowerCase();
        return HTML_ENTITIES[lower] ?? HTML_ENTITIES[entity] ?? entity;
    });

    // Fix run-together lowercase letter immediately after a colon between letters:
    // insert a space and uppercase that letter. Leaves '9:30' and 'Talk: AI' alone.
    out = out.replace(/([A-Za-z]):([a-z])/g, (_match, before: string, after: string) => {
        return `${before}: ${after.toUpperCase()}`;
    });

    // Collapse whitespace runs and remove space-before-punctuation.
    out = out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();

    return out;
}
