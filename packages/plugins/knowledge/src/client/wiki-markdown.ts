/**
 * WeKnora stores wiki links as `[[slug|label]]` — a dialect GFM does not know,
 * so the official markdown renderer would print the brackets literally. Rewrite
 * them into ordinary inline links carrying a `wiki:` destination, which the
 * reader intercepts and turns into navigation.
 *
 * The label keeps its original text (it may be the only human-readable part),
 * and a bare `[[slug]]` falls back to the slug's last segment.
 */
export const WIKI_LINK_SCHEME = 'wiki:';

/**
 * A wiki link: `[[slug]]` or `[[slug|label]]`. Neither half may contain square
 * brackets — WeKnora's own parser stops at the first `]`, so a label holding one
 * is not a link there either. Rejecting the whole match keeps that input
 * literal instead of emitting half a link and leaking a stray bracket.
 */
const WIKI_LINK = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;

/** `entity/acme-corp` → `acme-corp`: the part worth showing when no label exists. */
export function wikiSlugLabel(slug: string): string {
  const tail = slug.split('/').pop() ?? slug;
  return tail.trim() || slug;
}

/** Rewrite wiki links into `[label](wiki:slug)`; everything else is left alone. */
export function wikiLinksToMarkdown(markdown: string): string {
  return markdown.replace(WIKI_LINK, (match: string, rawSlug: string, rawLabel: string | undefined) => {
    const slug = rawSlug.trim();
    if (!slug) return match;
    const label = (rawLabel ?? '').trim() || wikiSlugLabel(slug);
    return `[${label}](${WIKI_LINK_SCHEME}${slug})`;
  });
}

/** The slug behind a `wiki:` destination, or undefined for any other href. */
export function wikiSlugFromHref(href: string | undefined): string | undefined {
  if (!href || !href.startsWith(WIKI_LINK_SCHEME)) return undefined;
  const slug = href.slice(WIKI_LINK_SCHEME.length).trim();
  return slug || undefined;
}
