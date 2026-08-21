import { WorldModel } from './WorldModel.js';
import { ServerIO }   from './ServerIO.js';
import { startWebChat } from './webchat.js';
import { queryOllama, OLLAMA_NUM_CTX } from './ollama.js';
import { buildPrompt } from './promptBuilder.js';
import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';
import { runPlan } from './parser.js';
import {
    log,
    printWorldState,
    think,
    stepToward,
    actOnTile,
} from './functions.js';

const STATE = Object.freeze({
    IDLE:       'idle',
    NAVIGATING: 'navigating',
    LLM_MODE:   'llm_mode',
});

export class LlmAgent {
    constructor({ name, host }) {
        this.name  = name;
        this.host  = host;
        this.STATE = STATE;

        this.world  = new WorldModel();
        this.io     = null;
        this.state  = STATE.IDLE;
        this.target = null;

        this.inputQueue = [];
        this.llmModeBusy = false; // true while waiting on Ollama's response
        this.sendReply = () => {}; // set in setup()
    }

    async setup(token) {
        log(this.name, 'setup', `host=${this.host} token=${token.slice(0, 10)}…`);

        const { sendReply } = startWebChat((text) => {
            this.inputQueue.push(text);
        });
        this.sendReply = sendReply;

        const client = DjsConnect(this.host, token);
        this.io      = new ServerIO(client, this.name);

        const mapReady = new Promise((resolve) => {
            client.onMap((_w, _h, rawTiles) => {
                if (rawTiles?.length) this.world.buildMap(rawTiles);
                resolve();
            });
        });

        const youReady = new Promise((resolve) => {
            client.onYou((you) => {
                this.world.updateMe(you);
                resolve();
            });
        });

        this.io.hookParcels((ps) => this.world.updateParcels(ps));
        this.io.hookAgents((agents) => { this.world.others = agents; });

        log(this.name, 'setup', 'waiting for map + you…');
        await Promise.all([mapReady, youReady]);

        if (!this.world.map)   throw new Error(`[${this.name}] map never arrived — check HOST`);
        if (!this.world.me.id) throw new Error(`[${this.name}] you-event never arrived — bad token?`);

        const { width, height } = this.world.map;
        log(this.name, 'setup', `READY  map=${width}x${height}`);
        console.log(`🤖 [${this.name}] connected at (${this.world.me.x},${this.world.me.y})`);
    }

    /**
     * Consumes the next queued chat text (if any), freezes the agent in
     * LLM_MODE, sends the built payload to Ollama, executes any planned tool
     * calls in order, and releases the agent as soon as the whole turn
     * (including all resulting tool calls) has finished.
     */
    process_input_prompt() {  
        // Don't start a new turn while one is already in flight, or if there's  
        // nothing queued to process.  
        if (this.llmModeBusy || this.inputQueue.length === 0) return;  
    
        const text = this.inputQueue.shift();  
        console.log(`[${this.name}][prompt] ${text}`);  
    
        // ── Enter LLM_MODE: freeze normal loop behavior until this resolves ──  
        this.state = STATE.LLM_MODE;  
        this.llmModeBusy = true;  
        log(this.name, 'llm_mode', 'entering LLM_MODE — waiting for Ollama response');  
    
        // Build the structured context payload (tools, world snapshot, memory, chat).  
        const payload = buildPrompt(this, text);  
        console.log(`[${this.name}][payload]`, JSON.stringify(payload, null, 2));  
    
        queryOllama(JSON.stringify(payload))  
            .then(async ({ message, promptTokens, replyTokens }) => {  
                // ── Context usage logging ──  
                const totalTokens = promptTokens + replyTokens;  
                log(this.name, 'context', `prompt=${promptTokens} reply=${replyTokens} total=${totalTokens}/${OLLAMA_NUM_CTX}`);  
    
                const rawText = message.content ?? '';  
                console.log(`[${this.name}][ollama][raw] ${rawText}`);  
    
                // ── Parse the LLM's JSON output: { plan: [...], chat: "..." } ──  
                let response;  
                try {  
                    response = JSON.parse(rawText);  
                } catch (e) {  
                    console.error(`[${this.name}][ollama] invalid JSON: ${e.message}`);  
                    this.sendReply(`[error: model did not return valid JSON]`);  
                    return;  
                }  
    
                if (!response || !Array.isArray(response.plan)) {  
                    console.warn(`[${this.name}][ollama] response missing valid "plan" array`);  
                    if (response?.chat) this.sendReply(response.chat);  
                    return;  
                }  
    
                // ── Execute the plan via parser.js (handles tool / if / loop steps,  
                //    including evaluateCondition checks inside loops), and it will  
                //    also send response.chat via this.sendReply internally. ──  
                const { results } = await runPlan(this, response);  
    
                const failed = results.filter((r) => !r.success);  
                console.log(`[${this.name}][plan] ${results.length} step(s) executed, ${failed.length} failed`);  
            })  
            .catch((e) => {  
                console.error(`[${this.name}][ollama] error:`, e.message);  
                this.sendReply(`[error: ${e.message}]`);  
            })  
            .finally(() => {  
                // ── Exit LLM_MODE regardless of success/failure ──  
                this.llmModeBusy = false;  
                this.state = STATE.IDLE;  
                log(this.name, 'llm_mode', 'response delivered — releasing agent');  
            });  
    }

    isInLlmMode() {
        return this.state === STATE.LLM_MODE && this.llmModeBusy;
    }

    async loop() {
        this.process_input_prompt();

        if (this.isInLlmMode()) {
            //log(this.name, 'loop', 'LLM_MODE active — frozen');
            return;
        }

        if (!this.world.map || !this.world.me.id) {
            log(this.name, 'loop', 'SKIP — not ready');
            return;
        }

        //printWorldState(this);

        if (await actOnTile(this)) {
            this.target = null;
            return;
        }

        this.target = think(this);
        if (!this.target) {
            this.state = STATE.IDLE;
            log(this.name, 'loop', 'nothing to do — idle');
            return;
        }

        if (this.world.isAt(this.target)) {
            await actOnTile(this);
            this.target = null;
            return;
        }

        this.state = STATE.NAVIGATING;
        const moved = await stepToward(this, this.target);
        if (!moved) this.target = null;
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const NAME  = process.env.AGENT_NAME  ?? 'agent1';
    const HOST  = process.env.HOST        ?? 'http://localhost:3000';
    const TOKEN = process.env.TOKEN       ?? '';

    const agent = new LlmAgent({ name: NAME, host: HOST });

    agent.setup(TOKEN).then(() => {
        setInterval(() => agent.loop(), 1000);
    }).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}