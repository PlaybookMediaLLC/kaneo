let waker: ((workspaceId: string) => void) | null = null;

/** Registers the in-process worker wake callback (set by worker.ts when the scheduler is active). */
export function registerQuillsWaker(
  fn: ((workspaceId: string) => void) | null,
): void {
  waker = fn;
}

/** Triggers a fast debounced Quills event drain when the scheduler is running; no-op otherwise. */
export function wakeQuillsWorkspace(workspaceId: string): void {
  if (waker && workspaceId) waker(workspaceId);
}
