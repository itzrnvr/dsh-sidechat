/**
 * Host half of the sidechat bundle.
 *
 * Two jobs:
 *
 * 1. Fork lineage. A fork records its origin in the child Session's stored
 *    header as `parentSession`, but the Client session list only surfaces that
 *    field for subagent sessions. This projection republishes it as a
 *    client-visible session projection (`projectionValues.sidechat.parentId`),
 *    which is the supported way to hand a log-derived value to the Client. The
 *    Client uses it to badge a normal fork — not to nest it.
 *
 * 2. Durable sidechat links. Whether a child is a *sidechat* or a normal fork
 *    is a Client-side decision, but it must survive app restarts: the Web UI is
 *    served on a fresh port every launch, so browser `localStorage` is a new
 *    origin each time. The link map therefore lives here, in
 *    `<DSH_HOME>/storages/dsh-sidechat-links.json`, served to the Client over
 *    exact `/api/sidechat/*` fetch routes (the same transport the shipped
 *    Host plugins use for their own `/api` endpoints).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// The desktop Host receives the profile directory as an argument, not as
// DSH_HOME, so this normally falls back to `~/.dsh` — the harness home that
// owns `sessions/` and `storages/` (session ids are global there).
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const LINKS_PATH = join(DSH_HOME, 'storages', 'dsh-sidechat-links.json');

const ROUTES = ['list', 'mark', 'unmark'];

const ok = (value) => ({ ok: true, value });
const fail = (message) => ({ ok: false, error: { code: 'internal', message, details: {} } });

/** Read the durable map, tolerating a missing or malformed file. */
function readLinks() {
  try {
    if (!existsSync(LINKS_PATH)) return {};
    const parsed = JSON.parse(readFileSync(LINKS_PATH, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const links = {};
    for (const [child, parent] of Object.entries(parsed)) {
      if (typeof child === 'string' && child.length > 0 && typeof parent === 'string' && parent.length > 0) {
        links[child] = parent;
      }
    }
    return links;
  } catch {
    return {};
  }
}

/** Write the durable map atomically (sidecar temp file + rename). */
function writeLinks(links) {
  try {
    mkdirSync(dirname(LINKS_PATH), { recursive: true });
    const temp = `${LINKS_PATH}.tmp`;
    writeFileSync(temp, `${JSON.stringify(links, null, 2)}\n`, 'utf8');
    renameSync(temp, LINKS_PATH);
    return true;
  } catch (error) {
    console.error('dsh-sidechat: could not persist sidechat links', error);
    return false;
  }
}

/** Pass-through schema: the shape is fixed and produced only by this unit. */
const lineageSchema = {
  parse: (value) => value,
};

/** One immutable state per Session: its fork parent, known from the header. */
const sidechatLineageProjection = {
  key: 'sidechat',
  stateVersion: 1,
  stateSchema: lineageSchema,
  init: (header) => ({
    parentId:
      typeof header?.parentSession === 'string' && header.parentSession.length > 0
        ? header.parentSession
        : null,
  }),
  // Lineage never changes after creation: every event keeps the same state
  // reference, which the registry treats as "nothing to publish".
  apply: (state) => state,
  wire: {
    viewSchema: lineageSchema,
    view: (state) => state,
  },
};

export const inject = ['sessionProjections'];

export function apply(ctx) {
  ctx.effect(
    () => ctx.sessionProjections.register(sidechatLineageProjection),
    'dsh-sidechat: lineage projection',
  );

  // ── durable sidechat links ──────────────────────────────────────────────
  let links = readLinks();

  const handle = async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'list':
          return ok({ links });
        case 'mark': {
          const child = payload?.childSessionId;
          const parent = payload?.parentSessionId;
          if (typeof child !== 'string' || child.length === 0) return fail('mark needs childSessionId');
          if (typeof parent !== 'string' || parent.length === 0) return fail('mark needs parentSessionId');
          if (child === parent) return fail('a session cannot be its own parent');
          links = { ...links, [child]: parent };
          writeLinks(links);
          return ok({ links });
        }
        case 'unmark': {
          const child = payload?.childSessionId;
          if (typeof child !== 'string' || child.length === 0) return fail('unmark needs childSessionId');
          if (links[child] !== undefined) {
            const next = { ...links };
            delete next[child];
            links = next;
            writeLinks(links);
          }
          return ok({ links });
        }
        default:
          return fail(`unknown sidechat method "${String(endpoint)}"`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  /** One exact Fetch route: validate the client envelope, answer it. */
  const route = (endpoint) => async (request) => {
    let message;
    try {
      message = await request.json();
    } catch {
      return new Response('body is not JSON', { status: 400 });
    }
    const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid';
    if (message?.type !== 'client-request' || message?.method !== `sidechat/${endpoint}`) {
      return Response.json({
        type: 'server-response',
        rpcId,
        result: fail('invalid client-request envelope'),
      });
    }
    const result = await handle(endpoint, message.payload);
    return Response.json({ type: 'server-response', rpcId, result });
  };

  // `connection.fetch.register` mounts exact `/api/...` routes on the shared
  // gateway channel — the same mechanism the shipped Host endpoints use. The
  // `connection.rpc.handle` facade is deliberately avoided: in 0.2.x it
  // resolves `webServer` on the connection plugin's own context, which does
  // not inject it, and every registration throws.
  ctx.inject(['connection'], (scope) => {
    for (const endpoint of ROUTES) {
      scope.effect(
        () => scope.connection.fetch.register({
          path: `/api/sidechat/${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: route(endpoint),
        }),
        `dsh-sidechat: /api/sidechat/${endpoint}`,
      );
    }
  });
}