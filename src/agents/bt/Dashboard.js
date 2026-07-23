export async function report(dashboardUrl, payload) {
    if (!dashboardUrl || !payload?.id) return;
    try {
        await fetch(`${dashboardUrl}/api/agents/${encodeURIComponent(payload.id)}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch { /* dashboard optional — never crash the agent */ }
}