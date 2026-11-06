-- RSM site tracking + Jarvis: one-time database setup.
-- Paste this whole file into the Neon SQL Editor and click Run.
-- BEFORE running: replace CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD below with a long random password
-- (20+ characters, letters and numbers). You'll use it once more, in DATABASE_URL_READONLY.

-- 1. Tables ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_views (
  id         bigserial PRIMARY KEY,
  path       text        NOT NULL,
  source     text        NOT NULL,   -- instagram | google | direct | other
  device     text        NOT NULL,   -- mobile | tablet | desktop
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS page_views_created_at ON page_views (created_at);

-- Contact form submissions (the site has no contact form yet; ready for when it does)
CREATE TABLE IF NOT EXISTS inquiries (
  id         bigserial PRIMARY KEY,
  name       text,
  email      text,
  phone      text,
  message    text,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiries_created_at ON inquiries (created_at);

-- 2. Read-only login for Jarvis ------------------------------------------------
-- Can only read these two tables. Can never insert, update, delete or change anything.
CREATE ROLE jarvis_readonly WITH LOGIN PASSWORD 'CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD';
ALTER ROLE jarvis_readonly SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE neondb TO jarvis_readonly;
GRANT USAGE ON SCHEMA public TO jarvis_readonly;
GRANT SELECT ON page_views, inquiries TO jarvis_readonly;
