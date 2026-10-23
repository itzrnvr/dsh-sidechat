# dsh-sidechat

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that branches the current session into a **sidechat** — a real forked session that opens in the right split view with the *exact same* conversation UI, leaving the main session completely untouched.

Useful when you want to explore a tangent without polluting the main thread: the parent keeps running, and you can talk to both in parallel.

![Sidechat in the right split view](docs/sidechat.png)

## Features

- **Real forks, not copies.** A sidechat is a genuine forked session created with the harness's native fork, so it inherits the full message history and every committed event.
- **Genuine UI clone.** The sidechat hosts the *actual* Conversation component — same composer, same model selector, same message rendering, same tool cards. It is not a reduced "mini chat".
- **Right split view.** Opens in the right sidebar as a tab alongside the parent, so both sessions are live at once.
- **Independent.** Continue the sidechat (and the parent) however you like; neither affects the other.
- **Durable.** Sidechats are normal sessions, and the tab addresses are durable — an open sidechat comes back after a restart.
- **Multiple at once.** Each sidechat opens as its own tab.
- **Theme and locale aware.** Uses host theme tokens and registers translations (English and Chinese).

## Install

Requires a DeepSeek Harness installation that supports bundles (0.2.x).

1. Clone or copy this directory somewhere permanent.
2. Install it as a bundle — either:
   - through the Plugin Manager UI (**install bundle** → select this directory), or
   - by having the agent install it: `plugin_manager` with `action: install_bundle` and `target` set to the absolute path of this directory.
3. Reload the harness page so the client module loads.

## Usage

- Hover a session row in the sidebar and click the **branch** button, or
- open that session's `⋯` menu and choose **New sidechat**.

The sidechat forks from the current point of the session and opens in the right split view.

Rows that are themselves fork children show a small branch glyph, and their hover card names the parent session.

## How it works

- `client.js` registers a resource provider (`dsh-resource://sidechat/session/<childId>`) that retains the forked session and releases it when the tab closes.
- It declares a right-sidebar tab kind (`sidechat`) plus a tab body that binds the retained session through `SessionProvider`.
- The conversation is rendered by the shared embedded Conversation factory (`conversation.content` with `variant: 'embedded'`), which is why the sidechat looks and behaves identically to the main session.
- Forking uses the native `sessions.fork()`; the tab is opened with `sidebarRight.openResource()`.
- `index.js` is the host half. It registers no services — everything is client-side.

## Known limitations

- **Fork boundary.** The fork uses the committed tail of the session, which is the end of the last completed assistant turn whenever the session is idle (the normal case). Starting a sidechat mid-stream captures the committed portion of the running turn.
- **Sidebar nesting.** Sidechats currently appear as sibling sessions with a branch glyph rather than indented child rows.
- **Model selection.** The composer model selector follows the sidechat session's own selection, exactly like any other session.

## License

MIT