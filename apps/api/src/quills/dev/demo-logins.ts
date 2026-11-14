import bcrypt from "bcryptjs";
import { and, eq, or } from "drizzle-orm";
import { getDatabase } from "../../database";
import { accountTable, userTable } from "../../database/schema";

/** A Kaneo account that is not a workspace member: it signs in to the portal as a customer. */
export const DEMO_CUSTOMER = {
  id: "quills_portal_demo_customer",
  email: "portal-customer@example.test",
  name: "Portal Demo Customer",
};

/**
 * Local test sign-ins for `pnpm dev:demo`: a password for the demo owner, and the demo customer.
 * Does nothing without a password. The password comes from the local demo secrets file.
 */
export async function seedDemoLogins(
  ownerId: string,
  password = process.env.QUILLS_DEMO_PASSWORD,
) {
  if (!password) return;
  const db = getDatabase();
  const taken = await db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(
      or(
        eq(userTable.id, DEMO_CUSTOMER.id),
        eq(userTable.email, DEMO_CUSTOMER.email),
      ),
    );
  if (
    taken.some(
      (row) => row.id !== DEMO_CUSTOMER.id || row.email !== DEMO_CUSTOMER.email,
    )
  )
    throw new Error("The demo customer ID or email belongs to another account");
  await db
    .insert(userTable)
    .values({ ...DEMO_CUSTOMER, emailVerified: true })
    .onConflictDoNothing();
  const hash = await bcrypt.hash(password, 10);
  for (const userId of [ownerId, DEMO_CUSTOMER.id]) {
    const [account] = await db
      .select({ id: accountTable.id })
      .from(accountTable)
      .where(
        and(
          eq(accountTable.userId, userId),
          eq(accountTable.providerId, "credential"),
        ),
      );
    if (account)
      await db
        .update(accountTable)
        .set({ password: hash })
        .where(eq(accountTable.id, account.id));
    else
      await db.insert(accountTable).values({
        userId,
        accountId: userId,
        providerId: "credential",
        password: hash,
      });
  }
}
