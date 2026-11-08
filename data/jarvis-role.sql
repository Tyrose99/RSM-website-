-- Database login for Jarvis's own tables (DATABASE_URL_JARVIS).
-- Can read and write ONLY the jarvis_* tables. It has no access at all to the site-tracking
-- tables (page_views, inquiries): Jarvis reads those through the separate read-only login.
-- Replace CHANGE_ME_JARVIS_APP_PASSWORD before running (letters and numbers only).
CREATE ROLE jarvis_app WITH LOGIN PASSWORD 'CHANGE_ME_JARVIS_APP_PASSWORD';
GRANT CONNECT ON DATABASE neondb TO jarvis_app;
GRANT USAGE ON SCHEMA public TO jarvis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  jarvis_memories, jarvis_tasks, jarvis_athletes, jarvis_deals, jarvis_businesses, jarvis_leads,
  jarvis_growth_moves, jarvis_activity, jarvis_drafts, jarvis_approvals, jarvis_briefings
  TO jarvis_app;
GRANT USAGE, SELECT ON
  jarvis_memories_id_seq, jarvis_tasks_id_seq, jarvis_athletes_id_seq, jarvis_deals_id_seq,
  jarvis_businesses_id_seq, jarvis_leads_id_seq, jarvis_growth_moves_id_seq, jarvis_activity_id_seq,
  jarvis_drafts_id_seq, jarvis_approvals_id_seq
  TO jarvis_app;
