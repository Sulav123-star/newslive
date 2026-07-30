import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type CustomItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  enclosure?: { url?: string };
  mediaContent?: { $: { url?: string } };
  mediaThumbnail?: { $: { url?: string } };
};

const parser: Parser<{}, CustomItem> = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

const FEEDS = [
  { url: "https://www.enr.com/rss/articles", source: "ENR" },
  { url: "https://www.constructiondive.com/feeds/news/", source: "Construction Dive" },
  { url: "https://www.constructionenquirer.com/feed/", source: "Construction Enquirer" },
];

function extractImage(item: CustomItem): string | null {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;

  const match = item.content?.match(/<img[^>]+src="([^">]+)"/i);
  return match ? match[1] : null;
}

async function syncConstructionNews() {
  let totalInserted = 0;
  const feedErrors: string[] = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);

      const rows = parsed.items
        .filter((item) => item.link && item.title)
        .map((item) => ({
          title: item.title!,
          source: feed.source,
          url: item.link!,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          excerpt: item.contentSnippet?.slice(0, 300) ?? null,
          thumbnail_url: extractImage(item),
        }));

      if (rows.length === 0) continue;

      const { error, count } = await supabase
        .from("construction_news")
        .upsert(rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });

      if (error) {
        feedErrors.push(`${feed.source}: ${error.message}`);
      } else {
        totalInserted += count ?? 0;
        console.log(`✓ ${feed.source}: processed ${rows.length} items`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      feedErrors.push(`${feed.source}: ${message}`);
      console.error(`✗ ${feed.source} failed: ${message}`);
    }
  }

  const { error: deleteError } = await supabase
    .from("construction_news")
    .delete()
    .lt("published_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (deleteError) {
    console.error(`Failed to prune old rows: ${deleteError.message}`);
  }

  console.log(`Sync complete. Inserted/updated: ${totalInserted}.`);
  if (feedErrors.length > 0) {
    console.error(`Errors:\n${feedErrors.join("\n")}`);
    process.exitCode = 1; // marks the GitHub Actions run as failed so you get notified
  }
}

syncConstructionNews();
