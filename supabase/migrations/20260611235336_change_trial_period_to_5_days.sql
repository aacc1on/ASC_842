ALTER TABLE subscriptions
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '5 days');
