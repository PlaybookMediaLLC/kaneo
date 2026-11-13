export function feedbackStages(
  statuses: Array<{ stage: string | null; name: string }>,
) {
  return [
    ...new Map(
      statuses
        .filter((status) => status.stage)
        .map((status) => [
          status.stage!,
          { value: status.stage!, label: status.name },
        ]),
    ).values(),
  ];
}
