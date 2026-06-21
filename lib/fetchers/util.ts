const USER_AGENT = 'NorthboundBot/1.0 (+https://github.com/CodeOfGordon)';

export async function getJSON<T = unknown>(url: string): Promise<T> {
    const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.json() as Promise<T>;
}

export async function getText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.text();
}

/** Crude but sufficient: drop tags, decode entities, squeeze whitespace. */
export function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&rsquo;/gi, "'")
        .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
}
