# construction-news-sync

A standalone job that pulls global construction industry news from RSS feeds
(ENR, Construction Dive, Construction Enquirer) and syncs it into a Supabase
table every 30 minutes via GitHub Actions. Fully decoupled from the Planxer
web app — this repo only writes to Supabase; your app reads from Supabase
independently (see the separate read API route in the main Planxer repo).

## Setup

### 1. Create the table (one-time, in Supabase)
Run this in the Supabase SQL Editor:
```sql
create table if not exists construction_news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null,
  url text not null unique,
  published_at timestamptz not null,
  thumbnail_url text,
  excerpt text,
  scope text default 'global',
  synced_at timestamptz default now()
);

create index if not exists idx_construction_news_published
  on construction_news (published_at desc);

alter table construction_news enable row level security;

create policy "Public can read construction news"
  on construction_news
  for select
  using (true);
```
(Same SQL as provided earlier — only the anon/authenticated roles are read-only;
this job writes using the service_role key, which bypasses RLS.)

### 2. Push this repo to GitHub
Create a new GitHub repo (can be private) and push these files to it.

### 3. Add repo secrets
Under **Settings → Secrets and variables → Actions**, add:
```
SUPABASE_URL               = https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY  = <service_role key from Project Settings → API>
```
The service_role key has full write access — it's only ever used inside
GitHub's secure Actions runner, never exposed to a browser.

### 4. Done — it runs automatically
The workflow (`.github/workflows/sync.yml`) runs every 30 minutes and on manual
trigger. Check progress under the repo's **Actions** tab.

## Running it locally (optional, for testing)
```bash
npm install
SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... npm run sync
```

## How the Planxer app reads this data
This repo has no opinion on your frontend — it only writes rows. Your Next.js
app's Construction News Panel should call its own read-only API route
(using the anon/public Supabase key) that selects from `construction_news`
ordered by `published_at desc`. That route lives in the Planxer repo, separate
from this one.

## Notes
- Rows older than 30 days are deleted automatically on every run.
- Deduping is handled by the `url` unique constraint + `upsert(..., { onConflict: "url" })`.
- If a single RSS feed is down, the others still sync — check the Action run's
  logs for per-feed errors; the job exits with a non-zero code (and shows red
  in the Actions tab) if any feed failed, so you'll notice.
