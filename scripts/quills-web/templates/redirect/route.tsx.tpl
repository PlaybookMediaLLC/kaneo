import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute({{FROM}})({ beforeLoad: ({ params }) => { throw redirect({ to: {{TO}}, params }); } });
