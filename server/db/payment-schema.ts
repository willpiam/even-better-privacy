export const PAYMENT_ORDER_SCHEMA_UPDATES = [
  `CREATE INDEX IF NOT EXISTS mail_payment_quoted_expiry
    ON mail_payment_orders (grace_until) WHERE active = 1 AND status = 'quoted'`,
  `CREATE INDEX IF NOT EXISTS mail_payment_pending_expiry
    ON mail_payment_orders (grace_until) WHERE active = 1 AND status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS mail_payment_pending_queue
    ON mail_payment_orders (last_checked, created_at) WHERE active = 1 AND status = 'pending'`,
  `CREATE TABLE IF NOT EXISTS mail_payment_transactions (
    order_id TEXT NOT NULL REFERENCES mail_payment_orders(order_id) ON DELETE CASCADE,
    network TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    submitted_at BIGINT NOT NULL,
    PRIMARY KEY (network, transaction_id)
  )`,
  `CREATE INDEX IF NOT EXISTS mail_payment_transactions_by_order
    ON mail_payment_transactions (order_id, submitted_at DESC, transaction_id)`,
  // Preserve existing claims, including paid and manually reviewed transactions.
  `INSERT INTO mail_payment_transactions (order_id, network, transaction_id, submitted_at)
    SELECT order_id, network, transaction_id, created_at
    FROM mail_payment_orders WHERE transaction_id IS NOT NULL
    ON CONFLICT (network, transaction_id) DO NOTHING`,
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
