# Teammate app design (RFC 0004, revision 2)

The owner chose the UserJot dashboard as the layout benchmark for the teammate app
(2026-11-14). It is a functional benchmark only: copy no UserJot code, text, icons or images.
Use Kaneo's UI components, theme tokens (light and dark) and lucide-react icons. Generic labels
such as "Open", "All" or "Reply" are fine.

## 1. Shell: one sidebar

The icon rail and the second nav column of revision 1 go away. One sidebar (about 300 px, a
light gray surface) holds everything. The main area is a white (or the dark theme's) surface.

Top row: the workspace switcher (logo, name, a small plan or role badge, a chevron), then two
icon buttons: "New request" (pen) and "Notifications" (bell).

Sections, each with a small uppercase label and a gap above:

1. **Conversations** (the label has a small "Beta"-style tag slot on the right, unused for now):
   - Queue: open conversations that wait for a team reply, unassigned first. An orange filled
     count badge when the count is above zero.
   - Open: open conversations, plain gray count.
   - All: every conversation.
   - Tickets and My tickets (Quills has tickets; they sit in this section).
2. **Requests** (feedback posts): one item for each workspace post status that is not closed,
   in status order (for example Pending, In Review, Planned, In Progress). Each item has the
   status icon (a rounded square that fills with the status color as the status advances) and
   its post count. The first status has the orange badge when it has posts.
3. **Workspace**: Roadmap, Changelog, Members, Share, and the Quills extras: Triage,
   Duplicates, Autopilot, Insights, Surveys, Settings (boards, voting, segments, task sync).

Hovering an item shows a small bell on the right: subscribe to that view's notifications
(keep it out if no API exists; do not fake it).

Bottom: a card "Desktop notifications / For new posts and comments" with a toggle (it asks the
browser for permission and stores the choice per device), and a "Support" link with a badge
slot. Below `md`, the sidebar becomes a sheet behind a menu button.

The active item has a white rounded pill background and a light border. Counts are right-aligned.

## 2. Conversations

Two panes in the main area: a list pane (about 360 px) and the conversation.

**List pane header:** the view title ("Open", "All", ...), then a "Queue" pill button with a
lightning icon (opens the next conversation in the queue), a filter icon button, a "New
message" icon button (tooltip), and a toggle that hides the list pane.

**Filter menu:** Open (checked when active), Mine, All, Unread, Snoozed, Resolved, a divider,
Spam, Archived, a divider, "Save as view…". Each item has an icon. Show only the ones the API
supports.

**Search field** under the header: "Search conversations…" with a search icon, full width,
rounded, gray fill.

**Rows:** a colored circle avatar with initials (or the photo), the name (bold for unread),
the date at the right ("Oct 31", or "now" when new), the preview line, and at the right of the
preview the assignee's mini avatar and a small green "RESOLVED" badge for resolved ones. The
selected row has a gray rounded background.

**Empty main pane:** a centered illustration icon, "No conversation selected" and "Open a
thread to read and reply."

**Conversation header:** the customer's avatar and name on the left. On the right: the
assignee pill ("You" with avatar when assigned to me; "Assign" with a person icon when not;
it opens a teammate picker), the status button ("Resolve" with a check icon; when resolved it
is a filled green "Resolved" pill that reopens on click), a kebab menu (Mark as spam, Archive,
a divider, "Block sender" in red), and a toggle for the right panel.

**Thread:** centered column (max about 820 px). Date separators with lines ("Sat, Oct 31",
"Today"). Customer messages on the left in a light gray bubble with the avatar; team replies on
the right in a blue bubble with white text and the teammate avatar. The time sits under each
bubble. A delivery failure shows in red under the bubble ("Email failed" with a warning icon).
System events are centered gray lines with an icon: "You resolved this conversation · 1:18 PM",
"You reopened this conversation", "Email to … could not be delivered — permanent bounce".
Internal notes use a yellow-tinted bubble with a "Note" label.

**Composer:** pinned to the bottom of the thread, a large rounded box "Reply to {name}…". The
toolbar has attach, emoji, a mode dropdown ("Reply" or "Note"), and on the right a microphone
slot (omit if unsupported) and a round send button with an up arrow. Enter sends; Shift+Enter
adds a line.

**Right panel** (toggle): a large avatar, the name, the email, then sections: "Email security"
(SPF, DKIM, DMARC check badges when the API has them; otherwise leave it out), company, segments,
attributes, tags, linked ticket, linked requests and "Create request", the AI summary.

**New message:** the main pane shows "‹ New message" and a card with "To: name or email
address" and "Subject: optional", then the composer.

## 3. Requests (feedback posts)

**List view** (no item open): full-width list. Header: the title ("Requests" or the status
name), a filter icon button, a search field "Search requests…" with a "/" key hint, a "Triage"
pill button with a lightning icon (opens the triage queue), and a black "New request" button.
Rows: the status icon, the title, then at the right: a red "STALE 6MO" badge when the post has
had no activity for a long time, the vote count (up arrow and number in a small pill), the
comment count (speech icon), the board chip (a colored dot and the board name in caps), the
date, and the author's avatar. No preview text, and never raw Markdown.

**Detail view:** the list pane on the left (title "Requests", filter and pane toggle, search;
compact cards: title with the status icon at the right, the author's avatar and name, votes,
comments, date). The main pane:

- Header: "‹ {board name}" on the left. On the right: a merge button (menu: "Merge with
  other…", "Merge others here…"), previous and next arrows, and a kebab menu (Visit, Share, Copy
  link, a divider, "Delete" in red).
- Content column (max about 800 px): the title (large, bold), the author's avatar, name, and
  "date · source", the body (rendered Markdown), then a chip row: the board chip, the visibility
  chip ("On board" with a globe), a "+" chip (add a tag), an AI sparkle chip (AI assist, only
  when AI is on); at the right the voter avatar stack, a vote pill (up arrow and count; it
  opens the voters and the proxy vote) and a kebab.
- A comment composer "Write a comment…" with attach, emoji, a visibility dropdown ("Public" or
  "Private note"), and a send button.
- Comments: avatar, name, date, text, a vote pill per comment at the right, a "Reply" link, and
  replies indented with a thread line.
- A floating action bar at the bottom center: the current status (status icon and name; a
  picker), "Merge", "Close", and a black primary button for the next status ("Accept" for a
  pending request). Next to it, a small pill with up and down arrows to move through the list.

**Merge palette:** a centered command-palette over a blurred page: a "Merge into" chip and a
search field "Find the request to merge this into…" with results as you type.

**New request modal:** a card with an author picker (avatar and name, it can pick a customer to
post on their behalf) "›" a board picker, a close button; a large "Submission title" field and
an "Add details" area; a footer with an image attach button, a status picker, a tags picker and
a black "Create" button.

## 4. Tickets

Same two-pane pattern as conversations: list pane with the same header controls (filter menu by
ticket status, search, new ticket), the ticket thread with the same bubbles and composer, the
header with assignee and status buttons and a kebab, and the right panel with the ticket
properties (priority, type, watchers, links, AI summary and field suggestions).

## 5. Other pages

Triage, Duplicates, Autopilot, Insights, Surveys, Changelog and Settings keep their behavior.
They use the same page header (title left, actions right), list rows and floating action bar
styles as Requests.

## 6. Rules

- Keep the keyboard support of revision 1: J/K and arrows move, Enter opens, Esc closes, R
  reply, N note, "/" focuses search, F filters. No shortcut fires inside a text field.
- Every list keeps loading, empty and error states. Lists refresh through the existing Quills
  WebSocket invalidation.
- Accessibility: landmarks (nav, list, main, complementary), `aria-current` on the active
  sidebar item, labeled icon buttons, menus with keyboard support.
- Previews and list rows show plain text. Strip Markdown before you show a preview.
