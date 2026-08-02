-- Track last activity per shared room for TTL garbage collection.
-- NULL means "no activity since creation/update"; cleanup uses COALESCE(last_activity, updated_at).
ALTER TABLE notes ADD COLUMN last_activity TEXT;
