/**
 * Multi-Agent Launcher
 * 
 * Runs multiple agents simultaneously in a single process.
 * Both agents will appear in the same dashboard at http://localhost:3001
 */

import '../core/dashboard/DashboardServer.js';
import { BehaviourTreeAgent } from '../agents/bt/BehaviourTreeAgent.js';
import { BdiAgent } from '../agents/bdi/BdiAgent.js';

// ========================================
// CONFIGURATION: Edit your tokens here
// ========================================

const agents = [
    {
        name: 'Agent 1 (teest)',
        host: "http://localhost:8080/",
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImQwMDRlNiIsIm5hbWUiOiJ0ZWVzdCIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzc0MzY0",
        type: 'bt'  // 'bt' for Behaviour Tree, 'bdi' for BDI
    },
    {
        name: 'Agent 2 (test2)',
        host: "http://localhost:8080/",
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjRmN2JjMiIsIm5hbWUiOiJ0ZXN0MiIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzg0MjM4Mjk1fQ.0DfA3_TT1XhIRMGP5x9ZZk6culBhIkkz8TbCHA5Kfac",
        type: 'bdi'  // 'bt' for Behaviour Tree, 'bdi' for BDI
    }
];

// ========================================
// Agent Startup Logic
// ========================================

async function startAgent(config) {
    console.log(`\n🤖 Starting ${config.name}...`);
    console.log(`   Type: ${config.type.toUpperCase()}`);
    console.log(`   Token: ${config.token.substring(0, 30)}...`);
    
    // Temporarily set environment for this agent's connection
    const originalHost = process.env.HOST;
    const originalToken = process.env.TOKEN;
    
    process.env.HOST = config.host;
    process.env.TOKEN = config.token;
    
    try {
        const Agent = config.type === 'bt' ? BehaviourTreeAgent : BdiAgent;
        const agent = new Agent();
        
        // Start agent (non-blocking)
        agent.start().catch(err => {
            console.error(`❌ ${config.name} error:`, err.message);
        });
        
        console.log(`✅ ${config.name} started successfully`);
    } catch (err) {
        console.error(`❌ Failed to start ${config.name}:`, err.message);
    } finally {
        // Restore original environment
        process.env.HOST = originalHost;
        process.env.TOKEN = originalToken;
    }
}

// ========================================
// Main Entry Point
// ========================================

console.log('╔═══════════════════════════════════════════════╗');
console.log('║   Multi-Agent Deliveroo Dashboard Launcher   ║');
console.log('╚═══════════════════════════════════════════════╝\n');

console.log(`📊 Dashboard will be available at: http://localhost:3001`);
console.log(`🎮 Starting ${agents.length} agent(s)...\n`);

// Start all agents
for (const agentConfig of agents) {
    await startAgent(agentConfig);
    // Small delay between agent startups
    await new Promise(resolve => setTimeout(resolve, 1000));
}

console.log('\n╔═══════════════════════════════════════════════╗');
console.log('║            All agents are running!            ║');
console.log('╚═══════════════════════════════════════════════╝');
console.log('\n📊 View dashboard at: http://localhost:3001');
console.log('🔄 Both agents will appear in the same dashboard');
console.log('🛑 Press Ctrl+C to stop all agents\n');

// Keep process alive
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down all agents...');
    process.exit(0);
});
