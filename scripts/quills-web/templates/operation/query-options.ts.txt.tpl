export const {{NAME}}Query = (input: {{PASCAL}}Request, viewer: Viewer) => queryOptions<{{PASCAL}}Response, PortalProblem>({ queryKey: {{NAME}}Key(input, viewer), queryFn: () => {{NAME}}(input) });
