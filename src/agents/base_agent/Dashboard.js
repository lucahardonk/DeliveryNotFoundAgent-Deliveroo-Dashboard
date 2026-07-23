// ─────────────────────────────────────────────────────────────────────────────
// Dashboard — POSTs agent state snapshots to the standalone dashboard server.
//
// This is entirely optional: if dashboardUrl is null the function is a no-op.
// Errors are caught and silently ignored so a dead dashboard never crashes an agent.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POSTs a state snapshot to /api/agents/:id/state on the dashboard server.
 *
 * @param {string|null} dashboardUrl  Base URL, e.g. "http://localhost:3001"
 * @param {object}      payload       Arbitrary JSON — whatever the dashboard expects
 */
export async function report(dashboardUrl, payload) {
    if (!dashboardUrl || !payload?.id) return;   // ← guard added

    try {
        await fetch(
            `${dashboardUrl}/api/agents/${encodeURIComponent(payload.id)}/state`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
            },
        );
    } catch {
        // Dashboard is optional — never crash the agent.
    }
}