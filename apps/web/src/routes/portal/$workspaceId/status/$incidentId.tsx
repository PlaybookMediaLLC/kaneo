import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/portal/$workspaceId/status/$incidentId")(
  {
    beforeLoad: ({ params }) => {
      throw redirect({
        to: "/portal/$workspaceId/status/incidents/$incidentId",
        params,
      });
    },
  },
);
