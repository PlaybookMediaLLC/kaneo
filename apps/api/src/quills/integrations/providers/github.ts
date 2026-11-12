// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { providerJson } from "../../framework/integration-config";
import {
  form,
  githubRepo,
  list,
  plainQuery,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const json = { "content-type": "application/json", accept: "application/json" };
const githubHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "Quills",
  "x-github-api-version": "2022-11-28",
});

export const github = {
  name: "GitHub",
  hosts: /^(api\.)?github\.com$/,
  category: "issue_tracking",
  description: "Create GitHub issues from new feedback and sync their status.",
  events: ["post.created"],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://github.com/login/oauth/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      state,
      scope: "repo",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      }),
    );
    // GitHub answers 200 with an error field for a rejected code.
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    const user = record(
      await providerJson("https://api.github.com/user", {
        headers: githubHeaders(accessToken),
      }),
    );
    const login = text(user.login);
    return {
      secrets: { accessToken },
      workspaceName: text(user.name) || login || "GitHub",
      account: login || null,
    };
  },
  destinations: async (secrets) =>
    list(
      await providerJson(
        "https://api.github.com/user/repos?per_page=100&sort=updated",
        { headers: githubHeaders(secrets.accessToken ?? "") },
      ),
    )
      .map(record)
      .map((repo) => text(repo.full_name))
      .filter((name) => /^[\w.-]+\/[\w.-]+$/.test(name))
      .map((name) => ({ id: name.replace("/", ":"), name })),
  search: async (secrets, target, query) =>
    list(
      record(
        await providerJson(
          `https://api.github.com/search/issues?${form({
            q: `${plainQuery(query)} repo:${githubRepo(target)} is:issue`,
            per_page: "20",
          })}`,
          { headers: githubHeaders(secrets.accessToken ?? "") },
        ),
      ).items,
    )
      .map(record)
      .map((issue) => ({
        externalId: `${githubRepo(target)}#${String(issue.number)}`,
        title: text(issue.title),
        url: text(issue.html_url) || null,
        state: text(issue.state) === "closed" ? "Closed" : "Open",
      })),
  statuses: ["Open", "Closed"],
  // `owner:repo` without `.` or `..` segments.
  target: (target) => {
    const parts = target.split(":");
    return (
      parts.length === 2 &&
      parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part)) &&
      parts.every((part) => part !== "." && part !== "..")
    );
  },
} satisfies OAuthProvider;
