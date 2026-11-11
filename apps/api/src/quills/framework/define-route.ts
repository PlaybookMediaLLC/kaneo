import type { RouteHandler } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  QuillsWorkspaceUnavailable,
  withQuillsAudience,
  withQuillsSigned,
  type Database,
  type QuillsActor,
} from "../../database/quills/client";
import { validationError } from "../../errors/validation-error";
import { boundedRequestBody } from "../../utils/bounded-request-body";
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
import {
  quillsActions,
  withQuillsRequest,
  type QuillsAction,
} from "../with-quills-request";
import {
  callerActor,
  enforceRateLimit,
  readCredentials,
  requestMeta,
  resolveCaller,
  type QuillsAudience,
  type QuillsCaller,
  type RequestMeta,
} from "./audience";
import { registry } from "./registry";
import {
  deliverySeen,
  internalTokenValid,
  recordDelivery,
  unauthorized,
  type Located,
  type SignedRequest,
  type SignedVerifier,
} from "./signed";

export type { Database, QuillsActor };

type Method = "get" | "post" | "put" | "delete" | "patch";
type Env = { Variables: BaseVariables & { workspaceId: string } };
// Tuples keep `any` (AnyQuillsRoute) on the teammate side instead of a union.
type RouteEnv<A> = [A] extends ["teammate"]
  ? Env
  : { Variables: BaseVariables };
type Errors = Partial<Record<400 | 403 | 404 | 409 | 502, string>>;
/** "signed": a machine caller that a verifier in signed.ts checks. "internal": the instance's own job waker. */
type Audience = "teammate" | QuillsAudience | "signed" | "internal";
/** The path parameter that names the workspace: an authorized ID for teammates, an ID or slug otherwise. */
type Scope<A> = [A] extends ["teammate"] ? "workspaceId" : "workspace";
/** Signed and internal routes name no workspace in the path: the credential (or nothing) decides it. */
type MachinePath<A, Path extends string> = [A] extends ["signed"]
  ? `/signed${Path}`
  : [A] extends ["internal"]
    ? `/internal${Path}`
    : `/{${Scope<A>}}${Path}`;
type Output<S> = S extends z.ZodType ? z.output<S> : undefined;
/** Signed routes read at most this much body: the bytes are kept for the signature check. */
const SIGNED_BODY_BYTES = 1_048_576;

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
  A extends Audience = "teammate",
  V = unknown,
  H = undefined,
  C = undefined,
> = {
  /**
   * Who calls the route. "teammate" (default) runs through withQuillsRequest under /quills.
   * "portal", "widget" and "public" mount under /quills-public through withQuillsAudience;
   * framework/audience.ts resolves their caller. "signed" mounts under /quills-public/signed
   * through withQuillsSigned after `verifier` checks the caller. "internal" mounts under
   * /quills-public/internal, opens no transaction and is hidden from the OpenAPI document.
   */
  audience?: A;
  /** Signed: checks the machine caller and names the credential's workspace (framework/signed.ts). */
  verifier?: SignedVerifier<V>;
  /** Signed: the teammate principal that the verified credential names, for the audit row. */
  actor?: (
    db: Database,
    located: Located,
  ) => Promise<QuillsActor["principalId"] | null>;
  /** Signed: the response to a delivery that was already processed. Nothing else runs. */
  replay?: z.input<NoInfer<R>>;
  /**
   * Teammate and signed: a read in its own scoped transaction, before `call`. It must not write.
   * The handler then runs in a new scoped transaction with the call's result as `called`.
   */
  prepare?: (
    input: QuillsRouteInput<P, Q, B> & { db: Database } & ([A] extends [
        "teammate",
      ]
        ? { actor: QuillsActor; loaded: L }
        : { credential: V; located: Located }),
  ) => Promise<H>;
  /** The provider call, with no database transaction open. Required with `prepare`. */
  call?: (prepared: H, input: QuillsRouteInput<P, Q, B>) => Promise<C>;
  /**
   * Teammate: the provider failure to answer after the handler's transaction commits, for example
   * when a refreshed token must be kept although the call after the refresh failed.
   */
  failure?: (called: C) => HTTPException | null | undefined;
  /** Portal and widget: false lets a caller without a session in. Default true. */
  signIn?: boolean;
  /** Portal: create the caller's customer profile and principal when missing. */
  ensureCustomer?: boolean;
  /** Non-teammate writes: attempts per client IP and workspace, counted even when the request fails. */
  rateLimit?: { limit: number; windowSeconds: number };
  method: M;
  /** Relative to /quills/{workspaceId}. */
  path: Path;
  operationId: string;
  summary: string;
  description?: string;
  /** Teammate: the checked Quills action. Other audiences: recorded for the ledger, not checked. */
  action: QuillsAction;
  /**
   * Teammate: give the handler `actions`, every Quills action that the caller holds. Use it when the
   * declared action is the minimum and another person's record needs more. Without it, `actions` is empty.
   */
  callerActions?: true;
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
      ) =>
        | z.input<typeof changeSchema>
        | z.input<typeof changeSchema>[]
        | false)
    | { none: string };
  handler: (
    // Teammate first: `any` (AnyQuillsRoute) resolves to the teammate shape.
    input: QuillsRouteInput<P, Q, B> &
      ([A] extends ["teammate"]
        ? {
            db: Database;
            actor: QuillsActor;
            loaded: L;
            actions: ReadonlySet<QuillsAction>;
            called: C;
          }
        : [A] extends ["signed"]
          ? {
              db: Database;
              credential: V;
              located: Located;
              called: C;
              request: RequestMeta;
            }
          : [A] extends ["internal"]
            ? {}
            : {
                db: Database;
                caller: QuillsCaller;
                request: RequestMeta;
                acceptLanguage: string | null;
              }),
  ) => Promise<z.input<R>>;
  /** Read-only shaping after commit, for example a visibility filter over public tables. */
  after?: (
    result: z.output<R>,
    input: QuillsRouteInput<P, Q, B> & { userId: string },
  ) => Promise<z.input<R>>;
};

export type AnyQuillsRoute = Omit<
  QuillsRouteDeclaration<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
  "handler"
> & {
  // Any audience's handler input; `db` stays typed for helpers that read it from here.
  handler: (
    input: QuillsRouteInput<any, any, any> & { db: Database } & Record<
        string,
        any
      >,
  ) => Promise<any>;
};

type QuillsRoute<
  M,
  Path extends string,
  P extends z.ZodObject,
  Q,
  B,
  R,
  E,
  A,
> = {
  method: M;
  path: MachinePath<A, Path>;
  operationId: string;
  tags: string[];
  summary: string;
  description?: string;
  middleware?: MiddlewareHandler[];
  request: {
    params: [A] extends ["signed" | "internal"]
      ? P
      : z.ZodObject<{ [K in Scope<A>]: z.ZodString } & P["shape"]>;
    query: Q;
    // Signed routes read and verify the raw body before parsing it, so no validator reads it first.
    body: [A] extends ["signed"]
      ? undefined
      : B extends z.ZodType
        ? { content: { "application/json": { schema: B } } }
        : undefined;
  };
  responses: {
    200: {
      description: string;
      content: { "application/json": { schema: R } };
    };
  } & Record<
    // Non-teammate routes may also return 401 (sign-in), 403 (blocked) and 429 (rate limit).
    | ([A] extends ["teammate"]
        ? 401 | 403
        : [A] extends ["signed"]
          ? 400 | 401 | 404 | 413
          : [A] extends ["internal"]
            ? 401 | 404
            : 401 | 403 | 404 | 429)
    | keyof E,
    ReturnType<typeof errorResponse>
  >;
};

// Without a JSON content type, @hono/zod-openapi passes an optional body through as an unvalidated {}.
function emptyBody(schema: z.ZodType) {
  const result = schema.safeParse({});
  if (!result.success) throw validationError(result.error.issues, "json");
  return result.data;
}

/** A signed route's JSON body, read from the verified raw bytes. 400 when it does not match. */
function parseRawBody(schema: z.ZodType, raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON" });
  }
  const result = schema.safeParse(value);
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
  A extends Audience = "teammate",
  V = unknown,
  H = undefined,
  C = undefined,
>(d: QuillsRouteDeclaration<M, Path, P, Q, B, R, E, L, A, V, H, C>) {
  // A signed route always writes (at least its delivery receipt), even an OAuth redirect's GET.
  if (
    d.audience === "signed"
      ? !d.event
      : (d.method === "get") === Boolean(d.event)
  )
    throw new Error(
      `${d.operationId}: a mutation or a signed route declares an event or { none: reason }; a read declares no event`,
    );
  if (d.after && d.method !== "get")
    throw new Error(
      `${d.operationId}: only a read can shape its result after commit`,
    );
  if (d.params?.def.checks?.length)
    throw new Error(
      `${d.operationId}: path parameter refinements are not kept`,
    );
  type Route = QuillsRoute<M, Path, P, Q, B, R, E, A>;
  // The handler's input type depends on the audience; each branch below passes its own shape.
  const handle = d.handler as (input: object) => Promise<z.input<R>>;
  const prepare = d.prepare as ((input: object) => Promise<H>) | undefined;
  const audience: Audience = d.audience ?? "teammate";
  if (Boolean(d.prepare) !== Boolean(d.call))
    throw new Error(`${d.operationId}: prepare and call come together`);
  if (d.prepare && !["teammate", "signed"].includes(audience))
    throw new Error(
      `${d.operationId}: prepare and call are for teammate and signed routes`,
    );
  if (d.actor && audience !== "signed")
    throw new Error(`${d.operationId}: only a signed route names its actor`);
  if ((audience === "signed") !== Boolean(d.verifier))
    throw new Error(
      `${d.operationId}: a signed route, and only one, names a verifier`,
    );
  if ((audience === "signed") !== (d.replay !== undefined))
    throw new Error(
      `${d.operationId}: a signed route, and only one, declares its replay response`,
    );
  if (audience === "signed" || audience === "internal") {
    if (
      d.native ||
      d.project ||
      d.load ||
      d.after ||
      d.callerActions ||
      d.signIn !== undefined ||
      d.ensureCustomer ||
      d.rateLimit
    )
      throw new Error(
        `${d.operationId}: signed and internal routes take none of the session or customer options`,
      );
    const signed = audience === "signed";
    if (!signed && (d.params || d.query || d.body))
      throw new Error(
        `${d.operationId}: an internal route takes no input from its caller`,
      );
    // The replay answer must satisfy the response contract too; a bad one fails at startup.
    if (signed) d.response.parse(d.replay);
    const route = createRoute({
      method: d.method,
      path: `/${audience}${d.path}`,
      operationId: d.operationId,
      tags: ["Quills"],
      summary: d.summary,
      description: [
        d.description,
        signed &&
          "The caller signs the raw request body; the body is parsed only after the signature check.",
      ]
        .filter(Boolean)
        .join(" "),
      // The internal job waker is not part of the public API.
      hide: !signed,
      security: [],
      middleware: signed ? [boundedRequestBody(SIGNED_BODY_BYTES)] : [],
      // Signed routes read and verify the raw body before parsing it, so no validator reads it first.
      request: { params: d.params, query: d.query },
      responses: {
        200: jsonResponse(d.responseDescription, d.response),
        401: errorResponse(signed ? "Invalid signature" : "Invalid token"),
        ...(signed &&
          d.body && {
            400: errorResponse("Invalid request body"),
            413: errorResponse("Request body is too large"),
          }),
        ...Object.fromEntries(
          Object.entries(d.errors ?? {}).map(([status, text]) => [
            status,
            errorResponse(text),
          ]),
        ),
        404: errorResponse(
          [
            d.errors?.[404],
            signed
              ? "Not configured, or no workspace owns the credential"
              : "Not configured",
          ]
            .filter(Boolean)
            .join("; "),
        ),
      },
    } as unknown as Route);
    if (!signed) {
      const handler = (async (
        c: Context<{ Variables: BaseVariables }, string, any>,
      ) => {
        const valid = internalTokenValid(c.req.raw.headers);
        if (valid === undefined)
          throw new HTTPException(404, { message: "Not found" });
        if (!valid) throw new HTTPException(401, { message: "Invalid token" });
        const result = d.response.parse(
          await handle({ params: {}, workspaceId: "" }),
        );
        return c.json(result, 200);
      }) as unknown as RouteHandler<typeof route, RouteEnv<A>>;
      return [route, handler] as const;
    }
    const verifier = d.verifier!;
    const handler = (async (
      c: Context<{ Variables: BaseVariables }, string, any>,
    ) => {
      if (verifier.disabled?.())
        throw new HTTPException(404, { message: "Not found" });
      const request: SignedRequest = {
        raw: await c.req.text(),
        headers: c.req.raw.headers,
        params: d.params
          ? (c.req.valid("param") as Record<string, string>)
          : {},
        query: d.query ? (c.req.valid("query") as Record<string, string>) : {},
      };
      const located = await verifier.locate(request);
      let body: unknown;
      const open = <T>(
        work: (
          db: Database,
          input: QuillsRouteInput<P, Q, B>,
          credential: V,
        ) => Promise<T>,
      ) =>
        withQuillsSigned(located.scope, async (db, workspace) => {
          const credential = verifier.verify
            ? await verifier.verify(db, request, located)
            : (located.claims as V);
          // Parsed once, after the first signature check: a forged request never reaches the schema.
          if (d.body && body === undefined)
            body = parseRawBody(d.body, request.raw);
          const input = {
            params: request.params,
            query: d.query && request.query,
            body,
            workspaceId: workspace.id,
          } as QuillsRouteInput<P, Q, B>;
          return work(db, input, credential);
        }).catch((error) => {
          if (error instanceof QuillsWorkspaceUnavailable)
            // An integration ID is a selector: an unknown one looks like a bad signature.
            throw "integration" in located.scope
              ? unauthorized()
              : new HTTPException(404, { message: "Not found" });
          throw error;
        });
      const REPLAY = Symbol("replay");
      let called = undefined as C;
      if (prepare) {
        const first = await open(async (db, input, credential) =>
          (await deliverySeen(db, verifier.name, located.deliveryId))
            ? REPLAY
            : {
                input,
                prepared: await prepare({ ...input, db, credential, located }),
              },
        );
        if (first === REPLAY) return c.json(d.replay, 200);
        called = await d.call!(first.prepared, first.input);
      }
      const result = await open(async (db, input, credential) => {
        if (!(await recordDelivery(db, verifier.name, located.deliveryId)))
          return REPLAY;
        const result = d.response.parse(
          await handle({
            ...input,
            db,
            credential,
            located,
            called,
            request: requestMeta(c.req.raw.headers),
          }),
        ) as z.output<R>;
        const change = typeof d.event === "function" && d.event(input, result);
        // A machine caller is no teammate and no customer: the audit row records a system change,
        // unless the credential names a teammate (an OAuth redirect started by one).
        const principalId = d.actor ? await d.actor(db, located) : null;
        for (const one of [change || []].flat())
          await recordQuillsChange(
            db,
            principalId ? { principalId, actorType: "user" } : null,
            one,
          );
        return result;
      });
      return c.json(result === REPLAY ? d.replay : result, 200);
    }) as unknown as RouteHandler<typeof route, RouteEnv<A>>;
    return [route, handler] as const;
  }
  if (audience !== "teammate") {
    if (d.native || d.project || d.load || d.after || d.callerActions)
      throw new Error(
        `${d.operationId}: native, project, load, after and callerActions are teammate-only`,
      );
    if (
      (d.ensureCustomer && audience !== "portal") ||
      (d.signIn !== undefined && audience === "public")
    )
      throw new Error(
        `${d.operationId}: ensureCustomer is portal-only and signIn does not apply to public routes`,
      );
    const signIn = audience !== "public" && d.signIn !== false;
    const route = createRoute({
      method: d.method,
      path: `/{workspace}${d.path}`,
      operationId: d.operationId,
      tags: ["Quills"],
      summary: d.summary,
      description: d.description,
      // Portal callers use their Kaneo session; widget callers use a widget session Bearer token.
      security: [],
      request: {
        params: z.object({
          workspace: z
            .string()
            .min(1)
            .max(200)
            .openapi({ description: "Workspace ID or slug" }),
          ...d.params?.shape,
        }),
        query: d.query,
        body: d.body && {
          content: { "application/json": { schema: d.body } },
        },
      },
      responses: {
        200: jsonResponse(d.responseDescription, d.response),
        ...(signIn && {
          401: errorResponse(
            audience === "portal"
              ? "Sign-in required"
              : "Valid widget session required",
          ),
        }),
        ...(audience !== "public" && {
          403: errorResponse("This account is blocked"),
        }),
        ...(d.rateLimit && { 429: errorResponse("Too many attempts") }),
        ...Object.fromEntries(
          Object.entries(d.errors ?? {}).map(([status, text]) => [
            status,
            errorResponse(text),
          ]),
        ),
        404: errorResponse(
          [d.errors?.[404], "Workspace not found or archived"]
            .filter(Boolean)
            .join("; "),
        ),
      },
    } as unknown as Route);
    const handler = (async (
      c: Context<{ Variables: BaseVariables }, string, any>,
    ) => {
      const params = c.req.valid("param") as { workspace: string };
      const input = {
        params,
        query: d.query && c.req.valid("query"),
        body:
          d.body &&
          (c.req.header("content-type")
            ? c.req.valid("json")
            : emptyBody(d.body)),
      };
      if (d.rateLimit)
        await enforceRateLimit(c, params.workspace, d.operationId, d.rateLimit);
      const credentials = await readCredentials(c, audience, params.workspace);
      const result = await withQuillsAudience(
        {
          workspace: params.workspace,
          kaneoUserId: credentials.account?.id,
          lock: d.method !== "get",
        },
        async (db, workspace) => {
          const scoped = {
            ...input,
            workspaceId: workspace.id,
          } as QuillsRouteInput<P, Q, B>;
          const caller = await resolveCaller(db, audience, credentials, {
            signIn,
            ensureCustomer: d.ensureCustomer === true,
          });
          const result = d.response.parse(
            await handle({
              ...scoped,
              db,
              caller,
              acceptLanguage: c.req.header("accept-language") ?? null,
              request: requestMeta(c.req.raw.headers),
            }),
          ) as z.output<R>;
          const change =
            typeof d.event === "function" && d.event(scoped, result);
          for (const one of [change || []].flat())
            await recordQuillsChange(db, callerActor(caller), one);
          return result;
        },
      ).catch((error) => {
        if (error instanceof QuillsWorkspaceUnavailable)
          throw new HTTPException(404, { message: "Workspace not found" });
        throw error;
      });
      return c.json(result, 200);
    }) as unknown as RouteHandler<typeof route, RouteEnv<A>>;
    return [route, handler] as const;
  }
  if (d.signIn !== undefined || d.ensureCustomer || d.rateLimit)
    throw new Error(
      `${d.operationId}: signIn, ensureCustomer and rateLimit are for non-teammate audiences`,
    );
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
        workspaceId: z.string().min(1).max(200),
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
  } as unknown as Route);

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
    const { load, project, callerActions } = d;
    let loaded = undefined as L;
    let actions: ReadonlySet<QuillsAction> = new Set();
    const access = {
      action: d.action,
      // A function project ID runs after the permission checks, so `load` and the action set run there too.
      projectId:
        (load || project || callerActions) &&
        (async () => {
          if (callerActions) actions = await quillsActions(c);
          if (load) loaded = await load({ ...input, userId: c.get("userId") });
          if (!project) return undefined;
          const projectId = await project(input);
          if (!projectId)
            throw new HTTPException(404, { message: "Project not found" });
          return projectId;
        }),
    };
    // Read, release the connection, call the provider, then write in a new scoped transaction.
    // The second transaction checks the permissions again.
    let called = undefined as C;
    if (prepare) {
      const prepared = await withQuillsRequest(c, access, (db, actor) =>
        prepare({ ...input, db, actor, loaded }),
      );
      called = await d.call!(prepared, input);
    }
    const result = await withQuillsRequest(c, access, async (db, actor) => {
      const result = d.response.parse(
        await handle({ ...input, db, actor, loaded, actions, called }),
      ) as z.output<R>;
      const change = typeof d.event === "function" && d.event(input, result);
      for (const one of [change || []].flat())
        await recordQuillsChange(db, actor, one);
      return result;
    });
    const failed = d.failure?.(called);
    if (failed) throw failed;
    const body = d.after
      ? d.response.parse(
          await d.after(result, { ...input, userId: c.get("userId") }),
        )
      : result;
    return c.json(body, 200);
  }) as unknown as RouteHandler<typeof route, RouteEnv<A>>;
  return [route, handler] as const;
}

/** Declares one Quills route. Mount the result with `router.openapi(...defineQuillsRoute({ ... }))`. */
export const defineQuillsRoute: typeof buildQuillsRoute = (d) => {
  const built = buildQuillsRoute(d);
  registry.set(d as unknown as AnyQuillsRoute, built[1]);
  return built;
};
