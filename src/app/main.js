// Starting the dashboard server (side-effect import) — serves the live UI and
// exposes the ingestion endpoint the agents push snapshots to.
import '../core/dashboard/DashboardServer.js';

import { createAgent } from './createAgent.js';

// Choose the strategy here: 'bt' (behaviour tree) or 'bdi'.
const agent = createAgent('bt');

await agent.start();
