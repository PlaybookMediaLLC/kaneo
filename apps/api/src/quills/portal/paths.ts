const clientBase = () =>
  (process.env.KANEO_CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");

const portalBase = (workspaceId: string) =>
  `${clientBase()}/portal/${encodeURIComponent(workspaceId)}`;

const portalPath = (workspaceId: string, path = "") =>
  `${portalBase(workspaceId)}${path}`;

export const portalPaths = {
  home: (workspaceId: string) => portalBase(workspaceId),
  board: (workspaceId: string, boardId: string) =>
    portalPath(workspaceId, `/boards/${encodeURIComponent(boardId)}`),
  post: (workspaceId: string, postId: string) =>
    portalPath(workspaceId, `/posts/${encodeURIComponent(postId)}`),
  conversation: (workspaceId: string, conversationId: string) =>
    portalPath(
      workspaceId,
      `/conversations/${encodeURIComponent(conversationId)}`,
    ),
  invite: (workspaceId: string, inviteId: string, token: string) =>
    `${portalPath(workspaceId, `/invite/${encodeURIComponent(inviteId)}`)}#${new URLSearchParams({ token })}`,
  csat: (workspaceId: string, token: string, rating: number) =>
    `${portalPath(workspaceId, "/csat")}?${new URLSearchParams({ token, rating: String(rating) })}`,
  unsubscribe: (workspaceId: string, token: string) =>
    `${portalPath(workspaceId, "/unsubscribe")}?${new URLSearchParams({ token })}`,
  status: (workspaceId: string) => portalPath(workspaceId, "/status"),
  statusIncident: (workspaceId: string, incidentId: string) =>
    portalPath(
      workspaceId,
      `/status/incidents/${encodeURIComponent(incidentId)}`,
    ),
  changelog: (workspaceId: string) => portalPath(workspaceId, "/changelog"),
  changelogEntry: (workspaceId: string, entryId: string) =>
    portalPath(workspaceId, `/changelog/${encodeURIComponent(entryId)}`),
  helpCenter: (workspaceId: string, locale?: string) =>
    portalPath(
      workspaceId,
      locale ? `/hc/${encodeURIComponent(locale)}` : "/hc",
    ),
  helpCenterCollection: (workspaceId: string, locale: string, idSlug: string) =>
    portalPath(
      workspaceId,
      `/hc/${encodeURIComponent(locale)}/collections/${encodeURIComponent(idSlug)}`,
    ),
  helpCenterArticle: (workspaceId: string, locale: string, idSlug: string) =>
    portalPath(
      workspaceId,
      `/hc/${encodeURIComponent(locale)}/articles/${encodeURIComponent(idSlug)}`,
    ),
  teammateConversation: (workspaceId: string, conversationId: string) =>
    `${clientBase()}/dashboard/workspace/${encodeURIComponent(workspaceId)}/quills/support/conversations/${encodeURIComponent(conversationId)}`,
} as const;

export const portalPathPatterns = [
  { id: "home", pattern: "/portal/$workspaceId" },
  { id: "board", pattern: "/portal/$workspaceId/boards/$boardId" },
  { id: "post", pattern: "/portal/$workspaceId/posts/$postId" },
  {
    id: "conversation",
    pattern: "/portal/$workspaceId/conversations/$conversationId",
  },
  { id: "invite", pattern: "/portal/$workspaceId/invite/$inviteId" },
  { id: "csat", pattern: "/portal/$workspaceId/csat" },
  { id: "unsubscribe", pattern: "/portal/$workspaceId/unsubscribe" },
  { id: "status", pattern: "/portal/$workspaceId/status" },
  {
    id: "statusIncident",
    pattern: "/portal/$workspaceId/status/incidents/$incidentId",
  },
  { id: "changelog", pattern: "/portal/$workspaceId/changelog" },
  {
    id: "changelogEntry",
    pattern: "/portal/$workspaceId/changelog/$entryId",
  },
  { id: "helpCenter", pattern: "/portal/$workspaceId/hc" },
  { id: "helpCenterLocale", pattern: "/portal/$workspaceId/hc/$locale" },
  {
    id: "helpCenterCollection",
    pattern: "/portal/$workspaceId/hc/$locale/collections/$idSlug",
  },
  {
    id: "helpCenterArticle",
    pattern: "/portal/$workspaceId/hc/$locale/articles/$idSlug",
  },
  {
    id: "teammateConversation",
    pattern:
      "/dashboard/workspace/$workspaceId/quills/support/conversations/$conversationId",
    pending: 132,
  },
] as const;
