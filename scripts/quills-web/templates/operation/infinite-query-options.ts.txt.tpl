export const {{NAME}}InfiniteQuery = (input: {{PASCAL}}Request, viewer: Viewer) =>
  infiniteQueryOptions<{{PASCAL}}Response, PortalProblem, InfiniteData<{{PASCAL}}Response>, ReturnType<typeof {{NAME}}Key>, {{PAGE_TYPE}}>({
    queryKey: {{NAME}}Key(input, viewer),
    initialPageParam: {{INITIAL_PAGE}},
    queryFn: ({ pageParam }) => {{NAME}}({ ...input, query: { ...input.query, {{PAGE_PARAMETER}}: {{PAGE_VALUE}} } }),
    getNextPageParam: (lastPage) => lastPage.{{NEXT_FIELD}} ?? undefined,
  });
