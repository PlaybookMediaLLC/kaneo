import type { RouteHandler } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Database, QuillsActor } from "../../database/quills/client";
import { validationError } from "../../errors/validation-error";
import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
  type BaseVariables,
} from "../../openapi";
import type { PermissionMap } from "../../utils/role-permissions";
import { requireWorkspacePermission } from "../../utils/require-workspace-permission";
import { workspaceAccess } from "../../utils/workspace-access-middleware";
import { recordQuillsChange, type changeSchema } from "../events";
import { withQuillsRequest, type QuillsAction } from "../with-quills-request";
import { registry } from "./registry";

/** The scoped handle a handler receives, for helpers that take it. */
export type { Database };

type Method = "get" | "post" | "put" | "patch" | "delete";
type Env = { Variables: BaseVariables & { workspaceId: string } };
type Errors = Partial<Record<403 | 404 | 409, string>>;
type Output<S> = S extends z.ZodType ? z.output<S> : undefined;

export type QuillsRouteInput<P, Q, B> = {
  params: Output<P>;
  query: Output<Q>;
  body: Output<B>;
  workspaceId: string;
};

export type QuillsRouteDeclaration<
  M extends Method,
  Path extends string,
  P extends z.ZodObject,
  Q extends z.ZodObject | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType,
  E extends Errors,
  L,
> = {
  method: M;
  /** Relative to /quills/{workspaceId}. */
  path: Path;
  operationId: string;
  summary: string;
  description?: string;
  action: QuillsAction;
  /** Extra Kaneo permissions, checked by route middleware. */
  native?: PermissionMap;
  /** Path parameters. The helper adds workspaceId. */
  params?: P;
  query?: Q;
  body?: B;
  /** Platform reads the handler needs. Runs after the permission checks, before the transaction. */
  load?: (input: QuillsRouteInput<P, Q, B> & { userId: string }) => Promise<L>;
  /** The persisted project to authorize. Runs after the permission checks. */
  project?: (input: QuillsRouteInput<P, Q, B>) => string | Promise<string>;
  response: R;
  responseDescription: string;
  /** Error descriptions. 401 and 403 are always declared. */
  errors?: E;
  /** Response keys that match the contract's forbidden names on purpose. */
  allowKeys?: string[];
  /** Required for a mutation. `none` records why the route writes no outbox event. */
  event?:
    | ((
        input: QuillsRouteInput<P, Q, B>,
        result: z.output<R>,
      ) => z.input<typeof changeSchema> | false)
    | { none: string };
  handler: (
    input: QuillsRouteInput<P, Q, B> & {
      db: Database;
      actor: QuillsActor;
      loaded: L;
    },
  ) => Promise<z.input<R>>;
  /** Read-only shaping after commit, for example a visibility filter over public tables. */
  after?: (
    result: z.output<R>,
    input: QuillsRouteInput<P, Q, B> & { userId: string },
  ) => Promise<z.input<R>>;
};

export type AnyQuillsRoute = QuillsRouteDeclaration<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;

type QuillsRoute<M, Path extends string, P extends z.ZodObject, Q, B, R, E> = {
  method: M;
  path: `/{workspaceId}${Path}`;
  operationId: string;
  tags: string[];
  summary: string;
  description?: string;
  middleware: MiddlewareHandler[];
  request: {
    params: z.ZodObject<{ workspaceId: z.ZodString } & P["shape"]>;
    query: Q;
    body: B extends z.ZodType
      ? { content: { "application/json": { schema: B } } }
      : undefined;
  };
  responses: {
    200: {
      description: string;
      content: { "application/json": { schema: R } };
    };
  } & Record<401 | 403 | keyof E, ReturnType<typeof errorResponse>>;
};

// Without a JSON content type, @hono/zod-openapi passes an optional body through as an unvalidated {}.
function emptyBody(schema: z.ZodType) {
  const result = schema.safeParse({});
  if (!result.success) throw validationError(result.error.issues, "json");
  return result.data;
}

/** Builds the route and its handler without registering them. Use defineQuillsRoute. */
export function buildQuillsRoute<
  M extends Method,
  Path extends string,
  R extends z.ZodType,
  P extends z.ZodObject = z.ZodObject<{}>,
  Q extends z.ZodObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  E extends Errors = {},
  L = undefined,
>(d: QuillsRouteDeclaration<M, Path, P, Q, B, R, E, L>) {
  if ((d.method === "get") === Boolean(d.event))
    throw new Error(
      `${d.operationId}: a mutation declares an event or { none: reason }; a read declares no event`,
    );
  if (d.after && d.method !== "get")
    throw new Error(
      `${d.operationId}: only a read can shape its result after commit`,
    );
  if (d.params?.def.checks?.length)
    throw new Error(
      `${d.operationId}: path parameter refinements are not kept`,
    );
  type Route = QuillsRoute<M, Path, P, Q, B, R, E>;
  // Key order matches the routes before the helper, so the OpenAPI document does not change.
  const route = createRoute({
    method: d.method,
    path: `/{workspaceId}${d.path}`,
    operationId: d.operationId,
    tags: ["Quills"],
    summary: d.summary,
    description: d.description,
    middleware: [
      workspaceAccess.fromParam("workspaceId"),
      ...(d.native ? [requireWorkspacePermission(d.native)] : []),
    ],
    request: {
      params: z.object({
        workspaceId: z.string().min(1),
        ...d.params?.shape,
      }),
      query: d.query,
      body: d.body && { content: { "application/json": { schema: d.body } } },
    },
    responses: {
      200: jsonResponse(d.responseDescription, d.response),
      401: errorResponse("Authentication required"),
      403: errorResponse("Insufficient access"),
      ...Object.fromEntries(
        Object.entries(d.errors ?? {}).map(([status, text]) => [
          status,
          errorResponse(text),
        ]),
      ),
    },
  } as Route);

  // Typed from the route, so `router.openapi` infers the exact path, input and output for the client.
  const handler = (async (c: Context<Env, string, any>) => {
    const input = {
      params: c.req.valid("param"),
      query: d.query && c.req.valid("query"),
      body:
        d.body &&
        (c.req.header("content-type")
          ? c.req.valid("json")
          : emptyBody(d.body)),
      workspaceId: c.get("workspaceId"),
    } as QuillsRouteInput<P, Q, B>;
    const { load, project } = d;
    let loaded = undefined as L;
    const result = await withQuillsRequest(
      c,
      {
        action: d.action,
        // A function project ID runs after the permission checks, so `load` runs there too.
        projectId:
          (load || project) &&
          (async () => {
            if (load)
              loaded = await load({ ...input, userId: c.get("userId") });
            if (!project) return undefined;
            const projectId = await project(input);
            if (!projectId)
              throw new HTTPException(404, { message: "Project not found" });
            return projectId;
          }),
      },
      async (db, actor) => {
        const result = d.response.parse(
          await d.handler({ ...input, db, actor, loaded }),
        ) as z.output<R>;
        const change = typeof d.event === "function" && d.event(input, result);
        if (change) await recordQuillsChange(db, actor, change);
        return result;
      },
    );
    const body = d.after
      ? d.response.parse(
          await d.after(result, { ...input, userId: c.get("userId") }),
        )
      : result;
    return c.json(body, 200);
  }) as unknown as RouteHandler<typeof route, Env>;
  return [route, handler] as const;
}

/** Declares one Quills route. Mount the result with `router.openapi(...defineQuillsRoute({ ... }))`. */
export const defineQuillsRoute: typeof buildQuillsRoute = (d) => {
  const built = buildQuillsRoute(d);
  registry.set(d, built[1]);
  return built;
};
