import { z } from 'zod';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * NewsSentimentTool
 * =================
 *
 * Read-only fetcher of recent crypto news headlines for a symbol/topic.
 *
 * Sources (free, no API key):
 *   - CoinDesk RSS (https://www.coindesk.com/arc/outboundfeeds/rss/)
 *   - CoinTelegraph RSS (https://cointelegraph.com/rss)
 *   - Bitcoin Magazine RSS (https://bitcoinmagazine.com/.rss/full/)
 *
 * Output is a list of (title, link, pubDate) items filtered to a topic
 * query. The tool deliberately does NOT classify sentiment itself — that's
 * the LLM analyst's job; this tool just hands the model the raw headlines.
 *
 * The same AbortController + deadline pattern as WebSearchTool applies.
 */
const InputSchema = z.object({
  query: z.string().min(1).max(100).describe('Topic / symbol to filter headlines by (e.g. "BTC", "Solana", "ETF").'),
  maxItems: z.number().int().min(1).max(20).default(8),
  maxChars: z.number().int().min(50).max(2_000).default(200),
});

const HeadlineSchema = z.object({
  title: z.string(),
  link: z.string().optional(),
  pubDate: z.string().optional(),
  source: z.string(),
});

const OutputSchema = z.object({
  query: z.string(),
  headlines: z.array(HeadlineSchema).default([]),
  summary: z.string(),
});

export type NewsSentimentToolInput = z.infer<typeof InputSchema>;
export type NewsSentimentToolOutput = z.infer<typeof OutputSchema>;

const FEEDS: Array<{ source: string; url: string }> = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml' },
  { source: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/' },
];

export function createNewsSentimentTool(timeoutMs: number): ToolDefinition<
  NewsSentimentToolInput,
  NewsSentimentToolOutput
> {
  return {
    name: 'news-sentiment',
    description:
      'Read-only fetcher of recent crypto news headlines from CoinDesk, CoinTelegraph and Bitcoin Magazine RSS feeds. Returns filtered headlines for a topic; the analyst LLM is expected to read the titles and infer sentiment. Use to ground directional views in news flow.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    readonly: true,
    async execute(input, ctx): Promise<ToolResult<NewsSentimentToolOutput>> {
      const startedAt = Date.now();
      try {
        const remainingMs = Math.max(500, ctx.deadlineMs - Date.now());
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), Math.min(remainingMs, timeoutMs));

        try {
          const feeds = await Promise.all(
            FEEDS.map(async (feed) => {
              try {
                const res = await fetch(feed.url, {
                  signal: ac.signal,
                  headers: { 'User-Agent': 'paper-broker-agent/1.0' },
                });
                if (!res.ok) return { source: feed.source, items: [] as Array<{ title: string; link?: string; pubDate?: string }> };
                const xml = await res.text();
                return { source: feed.source, items: parseRssItems(xml, feed.source) };
              } catch {
                return { source: feed.source, items: [] as Array<{ title: string; link?: string; pubDate?: string }> };
              }
            })
          );

          const q = input.query.toLowerCase();
          const matched: NewsSentimentToolOutput['headlines'] = [];
          for (const feed of feeds) {
            for (const item of feed.items) {
              if (item.title.toLowerCase().includes(q)) {
                matched.push({
                  title: item.title.slice(0, input.maxChars),
                  link: item.link,
                  pubDate: item.pubDate,
                  source: feed.source,
                });
                if (matched.length >= input.maxItems) break;
              }
            }
            if (matched.length >= input.maxItems) break;
          }

          const summary =
            matched.length === 0
              ? `No recent headlines matching "${input.query}" from ${feeds.map((f) => f.source).join(', ')}`
              : `${matched.length} headline(s) matching "${input.query}": ${matched.map((h) => h.title).join(' | ')}`;

          return {
            ok: true,
            data: { query: input.query, headlines: matched, summary },
            latencyMs: Date.now() - startedAt,
            truncated: false,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          ok: false,
          error: `news-sentiment: ${(err as Error).message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}

/**
 * Minimal RSS item parser. Handles both <item>...</item> (RSS 2.0) and
 * <entry>...</entry> (Atom). Returns titles + links + pubDates.
 *
 * We avoid pulling a full XML parser dep to keep the bundle lean and to make
 * the failure modes trivially inspectable in the call log.
 */
function parseRssItems(
  xml: string,
  source: string
): Array<{ title: string; link?: string; pubDate?: string }> {
  const items: Array<{ title: string; link?: string; pubDate?: string }> = [];
  // Match either <item> or <entry> blocks.
  const blockRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
  const blockMatches = xml.matchAll(blockRe);
  for (const block of blockMatches) {
    const body = block[1] ?? '';
    const title = extractTag(body, 'title');
    if (!title) continue;
    const link =
      extractTag(body, 'link') ||
      extractAttr(body, 'link', 'href') ||
      undefined;
    const pubDate = extractTag(body, 'pubDate') || extractTag(body, 'published') || extractTag(body, 'updated');
    items.push({ title: title.trim(), link, pubDate });
    if (items.length >= 20) break;
  }
  if (items.length === 0) {
    // Some feeds wrap everything in CDATA — at least surface that we got XML.
    void source;
  }
  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? (m[1] ?? '').trim() : undefined;
}

function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? (m[1] ?? '').trim() : undefined;
}
