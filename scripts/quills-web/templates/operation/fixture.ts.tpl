import type { {{PASCAL}}Response } from "./{{FILE}}";
export const {{NAME}}Fixture = {
  ok: (overrides: Partial<{{PASCAL}}Response> = {}) => ({ ...{{BODY}}, ...overrides }) satisfies {{PASCAL}}Response,
  problem: (status: {{STATUSES}}) => ({ status, body: { message: "Request could not be completed" } }),
};
