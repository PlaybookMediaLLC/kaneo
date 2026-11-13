import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/portal/$workspaceId/old")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/portal/$workspaceId/sample", params });
  },
});
