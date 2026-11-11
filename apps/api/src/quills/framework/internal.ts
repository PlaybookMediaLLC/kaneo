import { runQuillsJobs } from "../jobs/worker";

// Trusted for internal route modules only (boundaries.test.ts): the instance's own job loop.

/**
 * One bounded pass of the Quills job loop: up to 100 runnable workspaces from the cursor and a
 * 10-second budget, the same pass the scheduler runs. It takes no workspace from the caller.
 */
export const wakeQuillsJobs = () => runQuillsJobs();
