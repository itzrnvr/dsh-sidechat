window.__ModuleLoader__.load({
  id: '@local/dsh-sidechat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* ------------------------------------------------------------------ *
     * Identity + durable addressing
     *
     * A sidechat is a real forked Session. It is addressed in the right
     * Sidebar through a resource address that embeds the child Session id,
     * exactly the way the shipped subagent sidebar-chat does. Because the
     * address is durable, an open sidechat restores across restarts.
     * ------------------------------------------------------------------ */
    const SIDECHAT_ID = '@local/dsh-sidechat';
    const SIDECHAT_KIND = 'sidechat';
    const SIDECHAT_ADDRESS = 'dsh-resource://sidechat/session/';
    const NS = 'sidechat';

    function sidechatAddress(childSessionId, parentSessionId) {
      const query = new URLSearchParams({ parent: parentSessionId });
      return `${SIDECHAT_ADDRESS}${encodeURIComponent(childSessionId)}?${query}`;
    }

    function parseSidechatAddress(value) {
      let url;
      try { url = new URL(value); } catch (_invalid) { return undefined; }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== 'sidechat') return undefined;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== 'session') return undefined;
      const parentSessionId = url.searchParams.get('parent') || '';
      try {
        return { childSessionId: decodeURIComponent(parts[1]), parentSessionId };
      } catch (_invalidEncoding) {
        return undefined;
      }
    }

    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    }

    /* ------------------------------------------------------------------ *
     * Sidechat links — the durable parent → child map.
     *
     * A native fork records no lineage on the child Session (its header has
     * no parentSession/origin), and the shipped sidebar renders a flat list
     * with no nested session rows. The relationship is therefore kept here,
     * in browser storage, at the moment the fork happens.
     * ------------------------------------------------------------------ */
    const LINK_KEY = 'dsh.sidechat.links.v1';

    function readLinks() {
      try {
        const raw = window.localStorage.getItem(LINK_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (_e) {
        return {};
      }
    }

    function rememberSidechat(parentSessionId, childSessionId) {
      if (!parentSessionId || !childSessionId) return;
      try {
        const links = readLinks();
        links[childSessionId] = parentSessionId;
        window.localStorage.setItem(LINK_KEY, JSON.stringify(links));
      } catch (_e) { /* storage unavailable: nesting degrades, tabs still work */ }
    }

    function parentOf(sessionId) {
      return readLinks()[sessionId];
    }

    function childrenOf(sessionId) {
      const links = readLinks();
      return Object.keys(links).filter((child) => links[child] === sessionId);
    }

    /** Opens (or reveals) the right-Sidebar tab for one sidechat. */
    function openSidechatTab(ctx, childSessionId, parentSessionId) {
      try {
        ctx.sidebarRight.openResource(sidechatAddress(childSessionId, parentSessionId), {
          kind: SIDECHAT_KIND,
          preferNewPane: true,
        });
      } catch (error) {
        console.error('dsh-sidechat: failed to open sidechat tab', error);
      }
    }

    /* ------------------------------------------------------------------ *
     * Locale — register our dictionaries with the Client locale service so
     * translations follow the user's locale reactively; fall back to a
     * local dictionary when the service is unavailable.
     * ------------------------------------------------------------------ */
    const DICT = {
      en: {
        'action.newSidechat': 'New sidechat',
        'action.close': 'Close sidechat',
        'notice.forkedFrom': 'Forked from',
        'row.branchTitle': 'Sidechat',
        'row.sidechatsTitle': 'Sidechats',
        'command.side.label': 'Side',
        'command.side.description': 'Fork this session into a sidechat in the right split view',
      },
      zh: {
        'action.newSidechat': '新建侧边对话',
        'action.close': '关闭侧边对话',
        'notice.forkedFrom': '分支自',
        'row.branchTitle': '侧边对话',
        'row.sidechatsTitle': '侧边对话',
        'command.side.label': '侧边',
        'command.side.description': '将当前会话分支为右侧分栏中的侧边对话',
      },
    };

    function localTranslator(ctx) {
      return (key) => {
        let locale = 'en';
        try {
          const snap = ctx.locale.getLocale();
          locale = (snap && snap.locale) || snap || 'en';
        } catch (_e) { /* keep en */ }
        const dict = String(locale).startsWith('zh') ? DICT.zh : DICT.en;
        return dict[key] ?? DICT.en[key] ?? key;
      };
    }

    /* ------------------------------------------------------------------ *
     * Resource provider — owns the retained Session reference for one open
     * sidechat tab and releases it when the tab closes.
     * ------------------------------------------------------------------ */
    function sidechatResourceProvider(sessions) {
      return {
        protocol: 'sidechat',
        async *open(resourceAddress, { signal }) {
          const address = parseSidechatAddress(resourceAddress);
          if (address === undefined) {
            throw new Error(`dsh-sidechat: invalid resource address "${resourceAddress}"`);
          }
          if (signal.aborted) return;
          const reference = sessions.retain(address.childSessionId, {
            source: 'sidechat',
            signal,
          });
          try {
            yield { ok: true, value: { address, reference } };
            await waitForAbort(signal);
          } finally {
            reference.release();
          }
        },
      };
    }

    /* ------------------------------------------------------------------ *
     * Conversation host — the same embedded Conversation occurrence the
     * shipped sidebar-chat renders, so the sidechat is a genuine clone of
     * the main session: same composer, same model, same message rendering.
     * Mirrors the shipped ConversationSlotPanel exactly.
     * ------------------------------------------------------------------ */
    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }));
    }

    function ConversationSlotPanel({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
      const session = useSession((value) => value);
      const shellPhase =
        useConversation((value) => value).activeTargets.size > 0 ||
        (!session.blank && !session.awaitingFirstTurn) ||
        session.running
          ? 'active'
          : session.promptAttempted
            ? 'engaging'
            : 'blank';
      const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
      const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
      return renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero },
        { slots: { views: FixedChatConversationView } },
      );
    }

    /* ------------------------------------------------------------------ *
     * Right-Sidebar tab body — binds the retained child reference around
     * our own plugin-owned Conversation slot (declared as a child of the
     * tab body, so we never collide with the shipped subagent chat's
     * occupant of `sidebar.chat.conversation`).
     * ------------------------------------------------------------------ */
    function SidechatTab({ useResource, useTabInfo, SessionProvider, renderSlot }) {
      const { tab } = useTabInfo();
      const resource = useResource(tab.contentId);
      return h(
        'div',
        {
          className: 'dsh-sidechat-root',
          'data-dsh-sidechat': '',
          style: { width: '100%', minWidth: 0, height: '100%', minHeight: 0, display: 'flex' },
        },
        resource.value === undefined
          ? null
          : h(SessionProvider, { session: resource.value.reference }, renderSlot('sidechat.conversation', {})),
      );
    }

    /* ------------------------------------------------------------------ *
     * Fork — uses the native Client fork, i.e. the same operation as the
     * shipped "Fork" menu item: the child receives every committed event
     * of the parent. When the parent is idle (the normal case for starting
     * a sidechat) the committed tail IS the end of the last completed
     * assistant turn, which is the boundary we want.
     * ------------------------------------------------------------------ */
    function createSidechat(ctx, parentSessionId) {
      if (!parentSessionId) return Promise.resolve();
      return ctx.sessions
        .fork({
          sessionId: parentSessionId,
          increaseTitle: true,
          onCreated: (childSessionId) => {
            rememberSidechat(parentSessionId, childSessionId);
            openSidechatTab(ctx, childSessionId, parentSessionId);
          },
        })
        .catch((error) => {
          console.error('dsh-sidechat: fork failed', error);
        });
    }

    /* ------------------------------------------------------------------ *
     * Sidebar contributions — a "New sidechat" hover action and menu item
     * on every session row, a branch glyph on rows that are fork children,
     * and a hover-card line naming the parent session.
     * ------------------------------------------------------------------ */
    function branchGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.5, 'aria-hidden': true, style: { flex: 'none' },
        },
        h('path', { d: 'M4 2v6a3 3 0 0 0 3 3h6', strokeLinecap: 'round' }),
      );
    }

    function NewSidechatAction(props) {
      const label = props.t('action.newSidechat');
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-sidechat-action',
          title: label,
          'aria-label': label,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            props.createSidechat(props.sessionId);
          },
        },
        branchGlyph(),
      );
    }

    function NewSidechatMenuItem(props) {
      // The shipped menu hands each item a [open, setOpen] state hook so the
      // menu can close after an action; use it when present.
      const menuState = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : null;
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-sidechat-menuitem',
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            props.createSidechat(props.sessionId);
            if (typeof props.dismiss === 'function') props.dismiss();
            else if (typeof menuState?.[1] === 'function') menuState[1](false);
          },
        },
        branchGlyph(),
        h('span', { style: { flex: 1, minWidth: 0, textAlign: 'left' } }, props.t('action.newSidechat')),
      );
    }

    /** Reads one session summary without subscribing; rows re-render with
     *  the list anyway, so a plain snapshot read stays fresh. */
    function summaryOf(sessions, sessionId) {
      try {
        return sessions.list.getSnapshot().byId?.[sessionId];
      } catch (_e) {
        return undefined;
      }
    }

    /** Compact relative time, matching the sidebar's own vocabulary. */
    function relativeTime(updatedAt) {
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return '';
      const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60000));
      if (minutes < 1) return 'now';
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `${hours}h`;
      const days = Math.round(hours / 24);
      if (days < 30) return `${days}d`;
      return `${Math.round(days / 30)}mo`;
    }

    /** The parent a session was branched from, if it is one of our sidechats. */
    function resolveParentId(sessions, sessionId) {
      return parentOf(sessionId) || summaryOf(sessions, sessionId)?.parentId;
    }

    /** Leading branch marker for a session that is a sidechat child. */
    function SidechatBranchMarker(props) {
      if (!resolveParentId(props.sessions, props.sessionId)) return null;
      return h(
        'span',
        { className: 'dsh-sidechat-marker', title: props.t('row.branchTitle'), 'aria-hidden': true },
        branchGlyph(),
      );
    }

    /**
     * Hover-card section: names the parent when the session IS a sidechat,
     * and lists a parent's sidechats as an indented tree (connector line,
     * title, relative time) that opens each tab on click.
     *
     * The shipped sidebar renders a flat session list and offers no inline
     * row or child-row hook, so the tree lives in the parent's hover card —
     * the only place a plugin can group sessions under their originator.
     */
    function SidechatHoverSection(props) {
      const { sessions, sessionId, t, openSidechat } = props;
      const parentId = resolveParentId(sessions, sessionId);
      const children = childrenOf(sessionId).filter((id) => summaryOf(sessions, id) !== undefined);
      if (!parentId && children.length === 0) return null;

      const parts = [];

      if (parentId) {
        const parentTitle = summaryOf(sessions, parentId)?.title || parentId;
        parts.push(
          h(
            'span',
            { key: 'origin', className: 'dsh-sidechat-parentline' },
            branchGlyph(),
            h('span', { className: 'dsh-sidechat-ellipsis' }, `${t('notice.forkedFrom')} ${parentTitle}`),
          ),
        );
      }

      if (children.length > 0) {
        parts.push(
          h(
            'span',
            { key: 'label', className: 'dsh-sidechat-tree-label' },
            `${t('row.sidechatsTitle')} · ${children.length}`,
          ),
        );
        const ordered = children
          .map((id) => ({ id, summary: summaryOf(sessions, id) }))
          .sort((a, b) => (b.summary?.updatedAt ?? 0) - (a.summary?.updatedAt ?? 0));

        for (const { id, summary } of ordered) {
          const title = summary?.title || id;
          parts.push(
            h(
              'button',
              {
                key: id,
                type: 'button',
                className: 'dsh-sidechat-tree-item',
                title,
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openSidechat(id, sessionId);
                },
              },
              branchGlyph(),
              h('span', { className: 'dsh-sidechat-tree-title' }, title),
              h('span', { className: 'dsh-sidechat-tree-time' }, relativeTime(summary?.updatedAt)),
            ),
          );
        }
      }

      return h('span', { className: 'dsh-sidechat-tree' }, parts);
    }

    /* ------------------------------------------------------------------ *
     * Styles — inherit host theme tokens; literal colours are artwork only.
     * ------------------------------------------------------------------ */
    const CSS = [
      '.dsh-sidechat-action{',
      'align-items:center;background:transparent;border:0;',
      'border-radius:var(--dsw-radius-sm,6px);',
      'color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;',
      'display:inline-flex;flex:none;height:22px;justify-content:center;padding:0;width:22px;}',
      '.dsh-sidechat-action:hover,.dsh-sidechat-action:focus-visible{',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dsh-sidechat-menuitem{',
      'align-items:center;background:transparent;border:0;border-radius:var(--dsw-radius-sm,6px);',
      'color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;font-size:12px;gap:8px;',
      'padding:6px 8px;width:100%;}',
      '.dsh-sidechat-menuitem:hover,.dsh-sidechat-menuitem:focus-visible{',
      'background:var(--dsw-alias-bg-layer-2);}',
      '.dsh-sidechat-marker{',
      'align-items:center;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));',
      'display:inline-flex;flex:none;height:16px;justify-content:center;width:16px;}',
      '.dsh-sidechat-parentline{',
      'align-items:center;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;',
      'font-size:11.5px;min-width:0;}',
      '.dsh-sidechat-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsh-sidechat-tree{display:flex;flex-direction:column;gap:1px;min-width:0;width:100%;}',
      '.dsh-sidechat-tree-label{',
      'color:var(--dsw-alias-label-secondary);font-size:10.5px;font-weight:600;letter-spacing:.6px;',
      'margin:6px 0 2px;text-transform:uppercase;}',
      '.dsh-sidechat-tree-item{',
      'align-items:center;background:transparent;border:0;',
      'border-left:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));',
      'border-radius:0 var(--dsw-radius-sm,6px) var(--dsw-radius-sm,6px) 0;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;font-size:12px;',
      'gap:7px;padding:4px 6px 4px 9px;text-align:left;width:100%;}',
      '.dsh-sidechat-tree-item:hover,.dsh-sidechat-tree-item:focus-visible{',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dsh-sidechat-tree-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsh-sidechat-tree-time{',
      'color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));flex:none;font-size:10.5px;}',
    ].join('');

    function insertStyles() {
      if (typeof document === 'undefined') return () => {};
      if (document.querySelector('style[data-dsh-plugin-css="dsh-sidechat"]')) return () => {};
      const tag = document.createElement('style');
      tag.dataset.dshPluginCss = 'dsh-sidechat';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    /* ------------------------------------------------------------------ *
     * Module entry
     * ------------------------------------------------------------------ */
    return {
      inject: ['sessions', 'slots', 'locale', 'sidebarRight'],
      apply(ctx) {
        // Locale: register our dictionaries, then translate through the
        // service so the UI follows locale changes; local dict fallback.
        const localeState = { t: localTranslator(ctx) };
        const t = (key) => localeState.t(key);
        ctx.effect(() => {
          try {
            const dispose = ctx.locale.register(NS, { en: DICT.en, zh: DICT.zh });
            localeState.t = ctx.locale.bind(NS);
            return dispose;
          } catch (_e) {
            return undefined;
          }
        }, 'dsh-sidechat: locale');

        ctx.effect(insertStyles, 'dsh-sidechat: styles');

        // Track the on-screen session so affordances with no explicit
        // target still act on the session the user is looking at.
        let currentSessionId;
        const refreshCurrent = () => {
          const snapshot = ctx.sessions.list.getSnapshot();
          const ids = snapshot.ids || [];
          currentSessionId =
            ids.find((id) => (snapshot.byId?.[id]?.retainedBy?.mainView ?? 0) > 0) ?? ids[0];
        };
        ctx.effect(() => {
          try {
            refreshCurrent();
            return ctx.sessions.list.subscribe(refreshCurrent);
          } catch (_e) {
            return undefined;
          }
        }, 'dsh-sidechat: current session');

        // The fork-and-open operation, shared by every UI affordance.
        const openSidechatFor = (sessionId) => createSidechat(ctx, sessionId || currentSessionId);
        const withCreate = (Component) => (props) =>
          h(Component, { ...props, createSidechat: openSidechatFor, t });

        // `resources` and `sidebarRightTabs` are optional services: the
        // shipped reference reaches them through a nested inject so the
        // plugin still loads in a profile that lacks them.
        ctx.inject(['resources', 'sidebarRightTabs'], (scope) => {
          const sessions = scope.sessions ?? ctx.sessions;

          // Resource provider owns the retained Session for each open tab.
          ctx.effect(
            () => scope.resources.register(sidechatResourceProvider(sessions)),
            'dsh-sidechat: resources',
          );

          // Declare the right-Sidebar tab kind. Each sidechat address is
          // unique per child Session, so several sidechats open as
          // separate tabs without `multiple`.
          ctx.effect(
            () =>
              scope.sidebarRightTabs.register({
                id: SIDECHAT_ID,
                kind: SIDECHAT_KIND,
                priority: 'extension',
                patterns: [`${SIDECHAT_ADDRESS}**`],
                canOpen: (address) => parseSidechatAddress(address) !== undefined,
                title: (address) => {
                  const child = parseSidechatAddress(address)?.childSessionId;
                  if (child === undefined) return t('row.branchTitle');
                  return summaryOf(ctx.sessions, child)?.title || t('row.branchTitle');
                },
              }),
            'dsh-sidechat: tab type',
          );
        });

        // Tab body, keyed by the definition id. It declares our own
        // session-scoped child slot for the embedded Conversation.
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab',
                  key: SIDECHAT_ID,
                  children: { 'sidechat.conversation': { kind: 'single', scope: 'session' } },
                },
                SidechatTab,
              ),
            ),
          'dsh-sidechat: tab body',
        );

        // Conversation host for the bound child Session, in our own slot.
        ctx.effect(
          () =>
            ctx.slots.inject('sidechat.conversation', () =>
              ctx.slots.register({ name: 'sidechat.conversation' }, ConversationSlotPanel),
            ),
          'dsh-sidechat: conversation host',
        );

        // `/side` — a client-owned command. `kind: 'action'` runs entirely in
        // the browser: it never sends a message and never appends a session
        // event, so the parent session's log stays untouched.
        ctx.inject(['commandUi'], (scope) => {
          const commandUi = scope.commandUi ?? (typeof ctx.get === 'function' ? ctx.get('commandUi') : undefined);
          if (!commandUi) return;
          ctx.effect(
            () =>
              commandUi.register({
                name: 'side',
                label: () => t('command.side.label'),
                description: () => t('command.side.description'),
                available: () => true,
                ui: {
                  kind: 'action',
                  run: (session) => {
                    void createSidechat(ctx, (session && session.sessionId) || currentSessionId);
                  },
                },
              }),
            'dsh-sidechat: /side command',
          );
        });

        // Sidebar: hover action + "..." menu item on every session row.
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
              ctx.slots.register(
                { name: 'sidebar.workspaces.session.row.action', id: 'dsh-sidechat/new', order: 350 },
                withCreate(NewSidechatAction),
              ),
            ),
          'dsh-sidechat: row action',
        );

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
              ctx.slots.register(
                { name: 'sidebar.workspaces.session.menu.item', id: 'dsh-sidechat/new', order: 350 },
                withCreate(NewSidechatMenuItem),
              ),
            ),
          'dsh-sidechat: menu item',
        );

        // Sidebar: branch glyph on rows that are fork children.
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.session.row.leading', () =>
              ctx.slots.register(
                { name: 'sidebar.session.row.leading', id: 'dsh-sidechat/marker', order: 100 },
                withCreate((props) =>
                  h(SidechatBranchMarker, { ...props, sessions: ctx.sessions }),
                ),
              ),
            ),
          'dsh-sidechat: branch marker',
        );

        // Sidebar: hover card — a parent's sidechats as an indented tree, and
        // the parent's name on a sidechat row.
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.session.row.hover', () =>
              ctx.slots.register(
                { name: 'sidebar.session.row.hover', id: 'dsh-sidechat/parent', order: 100 },
                withCreate((props) =>
                  h(SidechatHoverSection, {
                    ...props,
                    sessions: ctx.sessions,
                    openSidechat: (childId, parentId) => openSidechatTab(ctx, childId, parentId),
                  }),
                ),
              ),
            ),
          'dsh-sidechat: hover tree',
        );
      },
    };
  },
});
