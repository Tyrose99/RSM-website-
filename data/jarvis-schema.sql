-- Jarvis tables. Only ADDS new jarvis_* tables; the site-tracking tables (page_views, inquiries) are not touched.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS jarvis_memories (
  id         bigserial PRIMARY KEY,
  content    text        NOT NULL,
  kind       text        NOT NULL DEFAULT 'fact',      -- fact | decision | deadline | client
  due_date   date,                                     -- for deadlines
  created_by text        NOT NULL,                     -- justin | tyler | jarvis
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_tasks (
  id           bigserial PRIMARY KEY,
  title        text        NOT NULL,
  details      text,
  owner        text        NOT NULL CHECK (owner IN ('justin', 'tyler', 'jarvis')),
  due_date     date,
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Business data (imported from data/rsm-data.json; editable by voice after a spoken confirmation)
CREATE TABLE IF NOT EXISTS jarvis_athletes (
  id bigserial PRIMARY KEY, name text NOT NULL, sport text, school text, status text,
  details jsonb NOT NULL DEFAULT '{}', sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jarvis_deals (
  id bigserial PRIMARY KEY, name text NOT NULL, athlete text, business text, stage text,
  amount numeric(12,2), close_date date,
  details jsonb NOT NULL DEFAULT '{}', sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jarvis_businesses (
  id bigserial PRIMARY KEY, name text NOT NULL, type text, instagram text, status text,
  details jsonb NOT NULL DEFAULT '{}', sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jarvis_leads (
  id bigserial PRIMARY KEY, name text NOT NULL, type text, status text, why text, pitch text,
  details jsonb NOT NULL DEFAULT '{}', sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jarvis_growth_moves (
  id bigserial PRIMARY KEY, title text NOT NULL, why text, first_step text, status text,
  details jsonb NOT NULL DEFAULT '{}', sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every change Jarvis makes: who asked, what, when
CREATE TABLE IF NOT EXISTS jarvis_activity (
  id         bigserial PRIMARY KEY,
  actor      text        NOT NULL,           -- justin | tyler | jarvis (scheduled)
  action     text        NOT NULL,           -- e.g. task.create, deal.update, memory.forget
  entity     text,
  entity_id  bigint,
  summary    text        NOT NULL,
  before     jsonb,
  after      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jarvis_activity_created_at ON jarvis_activity (created_at);

-- Email / DM drafts (editable; never sent without an approval tap)
CREATE TABLE IF NOT EXISTS jarvis_drafts (
  id         bigserial PRIMARY KEY,
  channel    text        NOT NULL CHECK (channel IN ('email', 'instagram_dm')),
  to_name    text,
  company    text,
  subject    text,
  body       text        NOT NULL DEFAULT '',
  source     jsonb,                          -- the message being replied to, if any
  created_by text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Approve / Reject queue for anything that would leave the app (send, post, delete outside RSM)
CREATE TABLE IF NOT EXISTS jarvis_approvals (
  id           bigserial PRIMARY KEY,
  kind         text        NOT NULL,         -- send_email | send_instagram_dm | ...
  draft_id     bigint REFERENCES jarvis_drafts (id),
  summary      text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by text        NOT NULL,
  decided_by   text,
  decided_at   timestamptz,
  result       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Daily briefings (one per New York date)
CREATE TABLE IF NOT EXISTS jarvis_briefings (
  for_date   date PRIMARY KEY,
  text       text        NOT NULL,
  data       jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Instagram (@rsm.collective, read-only) ----------
-- The long-lived access token, kept encrypted (AES-GCM). One row. The first token comes from the
-- INSTAGRAM_ACCESS_TOKEN Vercel variable; after that Jarvis keeps the refreshed one here.
CREATE TABLE IF NOT EXISTS jarvis_instagram_auth (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token_enc    text        NOT NULL,
  env_fp       text,                       -- fingerprint of the Vercel token it was seeded from (not the token)
  ig_user_id   text,
  username     text,
  expires_at   timestamptz,
  refreshed_at timestamptz,
  synced_at    timestamptz,                -- last time posts were pulled
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One follower-count snapshot per day, to graph growth
CREATE TABLE IF NOT EXISTS jarvis_instagram_followers (
  day         date PRIMARY KEY,
  followers   integer NOT NULL,
  follows     integer,
  media_count integer,
  captured_at timestamptz NOT NULL DEFAULT now()
);

-- Posts and reels with their numbers, plus a saved copy of the thumbnail (Instagram's image links expire)
CREATE TABLE IF NOT EXISTS jarvis_instagram_media (
  id           text PRIMARY KEY,
  media_type   text,                       -- IMAGE | VIDEO | CAROUSEL_ALBUM
  product_type text,                       -- FEED | REELS | STORY
  caption      text,
  permalink    text,
  posted_at    timestamptz,
  likes        integer,
  comments     integer,
  reach        integer,
  views        integer,
  saved        integer,
  shares       integer,
  interactions integer,
  thumb        bytea,
  thumb_type   text,
  insights_at  timestamptz,
  synced_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jarvis_instagram_media_posted ON jarvis_instagram_media (posted_at);
