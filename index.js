/**
 * Host half of the sidechat bundle.
 *
 * A fork records its origin in the child Session's stored header as
 * `parentSession`, but the Client session list only surfaces that field for
 * subagent sessions — so the sidebar cannot see which fork belongs to which
 * parent. This projection republishes the header's lineage as a
 * client-visible session projection (`projectionValues.sidechat.parentId`),
 * which is the supported way to hand a log-derived value to the Client.
 *
 * The registry validates state with the definition's schemas. This unit's
 * state is a single immutable `{ parentId }` derived from the header, so it
 * declares a minimal schema object instead of taking a schemastery
 * dependency.
 */

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
}