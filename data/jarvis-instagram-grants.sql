-- Lets the Jarvis login (jarvis_app) use the Instagram tables. Run after jarvis-schema.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON jarvis_instagram_auth, jarvis_instagram_followers, jarvis_instagram_media TO jarvis_app;
