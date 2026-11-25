export const PAYMENT_ORDER_SCHEMA_UPDATES = [
  `CREATE TABLE IF NOT EXISTS mail_payment_rates (
    asset TEXT PRIMARY KEY,
    last_attempt_at BIGINT NOT NULL,
    cached_at BIGINT,
    usd_rate TEXT
  )`,
  `DROP INDEX IF EXISTS mail_payment_transaction`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_verified_transaction
    ON mail_payment_orders (network, transaction_id)
    WHERE transaction_id IS NOT NULL AND status IN ('confirmed', 'fulfilled')`,
  `CREATE INDEX IF NOT EXISTS mail_payment_quoted_expiry
    ON mail_payment_orders (grace_until) WHERE active = 1 AND status = 'quoted'`,
  `CREATE INDEX IF NOT EXISTS mail_payment_pending_expiry
    ON mail_payment_orders (grace_until) WHERE active = 1 AND status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS mail_payment_pending_queue
    ON mail_payment_orders (last_checked, created_at) WHERE active = 1 AND status = 'pending'`,
  `CREATE TABLE IF NOT EXISTS mail_payment_candidates (
    order_id TEXT NOT NULL REFERENCES mail_payment_orders(order_id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL,
    submitted_at BIGINT NOT NULL,
    PRIMARY KEY (order_id, transaction_id)
  )`,
  `CREATE INDEX IF NOT EXISTS mail_payment_candidates_by_order
    ON mail_payment_candidates (order_id, submitted_at DESC, transaction_id)`,
  `INSERT INTO mail_payment_candidates (order_id, transaction_id, submitted_at)
    SELECT order_id, transaction_id, created_at
    FROM mail_payment_orders WHERE transaction_id IS NOT NULL
    ON CONFLICT (order_id, transaction_id) DO NOTHING`,
  // Repair completed signups whose old post-commit bookkeeping did not finish.
  `UPDATE mail_payment_orders SET status = 'fulfilled', active = 0
    WHERE active = 1 AND status IN ('confirmed', 'fulfilled')
      AND (status = 'fulfilled' OR EXISTS (
        SELECT 1 FROM mailboxes
        WHERE mailboxes.username = mail_payment_orders.username
          AND mailboxes.domain = mail_payment_orders.domain
          AND mailboxes.identity_fingerprint = mail_payment_orders.identity_fingerprint
          AND mailboxes.stalwart_id IS NOT NULL
      ))`,
];

export const MIGRATE_PAYMENT_CANDIDATES = [
  `INSERT INTO mail_payment_candidates (order_id, transaction_id, submitted_at)
    SELECT order_id, transaction_id, submitted_at FROM mail_payment_transactions WHERE TRUE
    ON CONFLICT (order_id, transaction_id) DO UPDATE SET submitted_at = excluded.submitted_at`,
  `DROP TABLE mail_payment_transactions`,
];
