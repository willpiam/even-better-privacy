import { initDb } from "../server/db/index.ts";
import { deleteHostedMailboxByAddress } from "../server/handlers/mail-signup.ts";

const [email, verifiedFingerprint] = Deno.args;
if (Deno.args.length !== 2 || !email || !verifiedFingerprint) {
  throw new Error("Usage: delete_hosted_mailbox.ts <mailbox-address> <verified-identity-fingerprint>");
}

const db = await initDb(Deno.env.get("DB_PATH") ?? "./ebp.sqlite");
try {
  await deleteHostedMailboxByAddress(db, email, verifiedFingerprint);
  console.log(`Deleted hosted mailbox ${email}`);
} finally {
  await db.close();
}
