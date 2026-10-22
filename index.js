/**
 * Host half of the sidechat bundle.
 *
 * The Client half owns every operation: forking uses the Client sessions
 * service (`ctx.sessions.fork`), and the right-Sidebar tab, resource
 * provider, and sidebar contributions are all registered from the Client
 * module. This Host half therefore registers no services of its own — it
 * exists so the bundle resolves as a normal two-half plugin.
 */
export function apply() {}
