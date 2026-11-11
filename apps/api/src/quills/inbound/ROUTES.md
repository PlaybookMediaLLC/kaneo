# P7b: inbound email and the internal job waker

Both routes mount from `quills/public.ts`, use `defineQuillsRoute` and have a fixture.

## Boundary map

```
Tables and owning schema:  quills: customer_identity, principal, conversations, conversation_messages,
                           kv_store (delivery receipts), events, job_queue, audit_log.
Actor and workspace:       the mail provider signature names no actor; the workspace is the owner of
                           the receiving address. The job waker has no workspace.
Permissions:               Svix signature (EMAIL_INBOUND_SIGNING_SECRET); QUILLS_INTERNAL_TOKEN.
Transactions:              prepare (no reads needed) -> Resend body fetch with no transaction -> one
                           scoped transaction for the customer, conversation, message and event.
External effects:          one GET to the Resend Received Emails API when the event has no body.
```

## Routes

| operationId | Route | Caller | Tables | Event | Tests |
|---|---|---|---|---|---|
| `receiveQuillsInboundEmail` | `POST /quills-public/signed/chat/email/inbound` | signed (Resend, Svix) | `customer_identity`, `principal`, `conversations`, `conversation_messages`, `kv_store` | `conversation.email_received` | contract signed table: bad key, stale timestamp, no headers, changed recipient, workspace B, replay |
| `wakeQuillsJobs` | `POST /quills-public/internal/job-wake` (hidden from OpenAPI) | internal (`Authorization: Bearer $QUILLS_INTERNAL_TOKEN`) | job tables, through the existing loop | none (each job records its own) | contract internal table: unset 404, no or wrong token 401 |

## Inbound email

- Provider: Resend inbound (`packages/email/src/quills/provider.ts`, `EMAIL_INBOUND_PROVIDER=resend`).
  The Svix signature is `base64(HMAC-SHA256(key, "<webhook-id>.<webhook-timestamp>.<raw body>"))`
  with a five-minute window; the signed `webhook-id` is the delivery ID.
- Routing: the first `to` address on `EMAIL_INBOUND_DOMAIN`, `<label>@domain` or `<label>+tag@domain`,
  names the workspace by ID or slug. A workspace that does not exist, is archived or never used Quills
  answers 404. Custom addresses on sending domains are not routed: P5b records those domains as
  `pending` and never verifies them, so their ownership is unproven.
- The body: the event's `text`, or Resend's Received Emails API with `EMAIL_RESEND_API_KEY` when the
  event has none. A missing mail there is an empty mail; another failure answers 500 and Resend
  redelivers (the receipt is not written).
- Threading: `In-Reply-To` or `References` that name an earlier inbound message of an email
  conversation append to it, when the sender is that conversation's visitor (`from_mismatch` otherwise).
  Other mail opens an email conversation. The sender's customer profile is found by email or created
  unverified: a From address is not proof of identity.
- A known Message-ID (`conversation_messages_email_message_id_idx`) or a known delivery is a no-op.
  Two copies of a new mail that arrive at once: the later one answers 409 and rolls back, so no empty
  conversation stays; the provider retries and finds the mail.
  A blocked sender, an empty body and other event types are acknowledged and dropped.
- Append uses `support/conversation-model.ts#preview` and `support/conversation-ops.ts#reopened`.

## Job wake

One bounded pass of `runQuillsJobs` (at most 100 runnable workspaces and a 10-second budget), the same
pass the scheduler runs every ten seconds. It takes no input: no workspace or job ID from the caller
reaches the trusted job path. It answers `{ degraded }`.

## Deferred or not implemented

| Source rows | Reason |
|---|---|
| `api/chat/email/events` (delivery events: bounced, complained) | Outbound mail does not tag its workspace yet, so a delivery event cannot name its workspace from a verified value. Needs the mail handler to tag sends. |
| Cloudflare raw-MIME inbound bridge | A second transport with its own credential and a MIME parser; Resend covers inbound. |
| Plus-address conversation and ticket routing (`<slug>+c<id>.<tag>@`) | Kaneo mints no reply addresses yet (replies are not mailed). Threading uses Message-ID headers. |
| Cold-inbound rate limit, spam filter, DMARC and ARC checks, auto-reply detection, attachments, quoted-reply stripping, auto-acknowledgement, the email log row | Large source modules that this slice does not port; the conversation records the mail as received. |
| Ticket replies by email | Need signed ticket reply addresses. |
| Job wake `workspaceKey`, `jobIds`, `abort` | The source wakes a fleet worker for one workspace; Kaneo runs one shared loop. |
