// src/agents/LLM_agent/Chat.js
import http from "node:http";

export class ChatServer {
    constructor({ agent, port = 8090 }) {
        this.agent = agent;
        this.port = port;
    }

    start() {
        const server = http.createServer(async (req, res) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
            if (req.method === "OPTIONS") {
                res.writeHead(204);
                return res.end();
            }

            if (req.method === "POST" && req.url === "/instruct") {
                let body = "";
                req.on("data", (c) => (body += c));
                req.on("end", async () => {
                    try {
                        const { text } = JSON.parse(body || "{}");
                        if (!text) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            return res.end(JSON.stringify({ error: 'Missing "text" field' }));
                        }
                        const answer = await this.agent.processChat(text);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ answer }));
                    } catch (err) {
                        console.error("[ChatServer] error:", err.message);
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            if (req.method === "GET" && req.url === "/messages") {
                res.writeHead(200, { "Content-Type": "application/json" });
                return res.end(JSON.stringify(this.agent.getChatHistory()));
            }

            if (req.method === "GET" && req.url === "/debug") {
                try {
                    const state = this.agent.getDebugState
                        ? this.agent.getDebugState()
                        : { error: "getDebugState not implemented on agent" };
                    res.writeHead(200, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify(state));
                } catch (err) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ error: err.message }));
                }
            }

            if (req.method === "GET" && req.url === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                return res.end(this._buildHtml());
            }

            res.writeHead(404);
            res.end("Not found");
        });

        server.listen(this.port, () => {
            console.log(`[ChatServer] running on http://localhost:${this.port}`);
        });
    }

    _buildHtml() {
        return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${this.agent.name} — Chat &amp; Debug</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; max-width: 1400px; margin: 20px auto; padding: 0 16px; background:#f9fafb; color:#111; }
  h2 { margin-bottom: 12px; }
  .layout { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
  .col { flex:1; min-width: 380px; }
  #log { background:#fff; border:1px solid #e5e7eb; border-radius:12px; height: 520px; overflow-y:auto; padding: 14px; margin-bottom: 12px; display:flex; flex-direction:column; gap:8px; }
  .msg { padding: 10px 12px; border-radius: 10px; line-height:1.45; word-wrap:break-word; }
  .msg b { display:block; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px; opacity:0.7; }
  .system { background:#f3f4f6; color:#374151; font-size:0.85em; }
  .user { background:#dbeafe; color:#1e3a8a; align-self:flex-end; max-width:80%; }
  .assistant { background:#dcfce7; color:#14532d; align-self:flex-start; max-width:80%; }
  .tool { background:#fef9c3; color:#713f12; font-family: ui-monospace, monospace; font-size:0.88em; }
  .empty { font-style:italic; opacity:0.7; }
  .status { align-self:center; font-size:0.85em; color:#6b7280; padding:4px 12px; }
  #inputRow { display:flex; gap:8px; }
  #textInput { flex:1; padding:10px 12px; border:1px solid #d1d5db; border-radius:10px; font-size:1rem; }
  button { padding:10px 18px; border:0; border-radius:10px; background:#2563eb; color:#fff; font-weight:600; cursor:pointer; }
  button:disabled { opacity:0.6; cursor:not-allowed; }
  .error { color:#b91c1c; background:#fee2e2; padding:8px 12px; border-radius:8px; font-size:0.9em; }

  /* Debug panel */
  #debugPanel { background:#0f172a; color:#e2e8f0; border-radius:12px; padding:14px; height:700px; overflow-y:auto; font-family: ui-monospace, monospace; font-size:0.8em; }
  #debugPanel h3 { color:#93c5fd; margin:0 0 8px; font-size:0.95em; }
  .dbg-section { margin-bottom:16px; border-bottom:1px solid #1e293b; padding-bottom:10px; }
  .dbg-row { margin:2px 0; }
  .dbg-key { color:#7dd3fc; }
  .badge { display:inline-block; padding:2px 8px; border-radius:6px; font-size:0.78em; font-weight:600; }
  .badge.running { background:#facc15; color:#78350f; }
  .badge.completed { background:#4ade80; color:#14532d; }
  .badge.blocked { background:#f87171; color:#7f1d1d; }
  .queue-item { border-radius:8px; padding:8px; margin:6px 0; }
  .queue-item.plan { background:#1e2a4a; border-left:3px solid #60a5fa; }
  .queue-item.executed { background:#1e293b; border-left:3px solid #4ade80; }
  .queue-item.failed { background:#1e293b; border-left:3px solid #f87171; }
  .queue-item.rejected { background:#1e293b; border-left:3px solid #fbbf24; }
  .kind-label { font-weight:700; font-size:0.75em; text-transform:uppercase; letter-spacing:0.04em; }
  .kind-label.plan { color:#93c5fd; }
  .kind-label.executed { color:#86efac; }
  .kind-label.failed { color:#fca5a5; }
  .kind-label.rejected { color:#fde68a; }
  pre { white-space:pre-wrap; word-break:break-word; margin:4px 0; }
  #refreshInfo { text-align:right; font-size:0.75em; color:#6b7280; margin-top:4px; }
</style>
</head>
<body>
<h2>🤖 ${this.agent.name} — Chat &amp; Debug</h2>
<div class="layout">
  <div class="col">
    <div id="log"></div>
    <div id="inputRow">
      <input id="textInput" placeholder="es. vai su e raccogli il pacco" autofocus autocomplete="off" />
      <button id="sendBtn">Invia</button>
    </div>
  </div>
  <div class="col">
    <div id="debugPanel"><em>Caricamento stato…</em></div>
    <div id="refreshInfo">aggiornato ogni 1.5s</div>
  </div>
</div>

<script>
  const log = document.getElementById('log');
  const input = document.getElementById('textInput');
  const btn = document.getElementById('sendBtn');
  const debugPanel = document.getElementById('debugPanel');

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function render(messages) {
    log.innerHTML = messages.map(m => {
      let role = m.role || 'unknown';
      let content = m.content ?? '';
      if (m.tool_calls && m.tool_calls.length) {
        role = 'assistant';
        content = m.tool_calls.map(c => '🔧 ' + escapeHtml(c.function.name) + '(' + escapeHtml(c.function.arguments) + ')').join('\\n');
      }
      const body = content ? escapeHtml(content).replace(/\\n/g,'<br>') : '<span class="empty">(nessun testo)</span>';
      return '<div class="msg ' + role + '"><b>' + role + '</b>' + body + '</div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  function setStatus(txt) {
    let el = document.getElementById('typing-indicator');
    if (!el) { el = document.createElement('div'); el.id = 'typing-indicator'; el.className = 'status'; log.appendChild(el); }
    el.textContent = txt;
    log.scrollTop = log.scrollHeight;
  }

  function clearStatus() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
  }

  async function refresh() {
    try {
      const r = await fetch('/messages');
      if (!r.ok) throw new Error('Fetch failed');
      const msgs = await r.json();
      render(msgs);
    } catch (e) { console.error(e); }
  }

  function renderQueueItem(item) {
    const kind = item.kind || 'executed';
    let html = '<div class="queue-item ' + kind + '">';
    html += '<span class="kind-label ' + kind + '">' + kind + '</span>';

    if (kind === 'plan') {
      html += '<div class="dbg-row"><span class="dbg-key">status:</span> ' + escapeHtml(item.status) + '</div>';
      if (item.thought) html += '<pre>thought: ' + escapeHtml(item.thought) + '</pre>';
      if (item.reason) html += '<pre>reason: ' + escapeHtml(item.reason) + '</pre>';
      if (Array.isArray(item.steps) && item.steps.length) {
        html += '<pre>steps: ' + escapeHtml(JSON.stringify(item.steps, null, 1)) + '</pre>';
      }
    } else {
      html += '<div class="dbg-row"><span class="dbg-key">tool:</span> ' + escapeHtml(item.tool || '—') + '</div>';
      if (item.args) html += '<pre>args: ' + escapeHtml(JSON.stringify(item.args)) + '</pre>';
      if (item.rationale) html += '<pre>rationale: ' + escapeHtml(item.rationale) + '</pre>';
      if (item.error) html += '<pre>error: ' + escapeHtml(item.error) + '</pre>';
      if (item.result) html += '<pre>result: ' + escapeHtml(JSON.stringify(item.result)) + '</pre>';
    }
    html += '</div>';
    return html;
  }

  function renderDebug(state) {
    if (state.error) {
      debugPanel.innerHTML = '<div class="error">' + escapeHtml(state.error) + '</div>';
      return;
    }

    const carrying = (state.agent.carrying || []).map(p => p.id).join(', ') || '—';
    const pos = state.agent.position ? '(' + state.agent.position.x + ', ' + state.agent.position.y + ')' : '—';

    let html = '';

    html += '<div class="dbg-section">';
    html += '<h3>🧍 Agente</h3>';
    html += '<div class="dbg-row"><span class="dbg-key">nome:</span> ' + escapeHtml(state.agent.name) + '</div>';
    html += '<div class="dbg-row"><span class="dbg-key">posizione:</span> ' + pos + '</div>';
    html += '<div class="dbg-row"><span class="dbg-key">carrying:</span> ' + escapeHtml(carrying) + '</div>';
    html += '<div class="dbg-row"><span class="dbg-key">messaggi in chat:</span> ' + state.chatLength + '</div>';
    html += '</div>';

    html += '<div class="dbg-section">';
    html += '<h3>🗺️ Mondo</h3>';
    html += '<div class="dbg-row"><span class="dbg-key">mappa caricata:</span> ' + (state.world.mapLoaded ? 'sì' : 'no') + '</div>';
    if (state.world.mapSize) {
      html += '<div class="dbg-row"><span class="dbg-key">dimensioni:</span> ' + state.world.mapSize.width + ' x ' + state.world.mapSize.height + '</div>';
    }
    html += '<div class="dbg-row"><span class="dbg-key">delivery tiles:</span> ' + state.world.deliveryTiles.length + '</div>';
    html += '<div class="dbg-row"><span class="dbg-key">pacchi visibili:</span> ' + state.world.parcels.length + '</div>';
    if (state.world.parcels.length) {
      html += '<pre>' + escapeHtml(JSON.stringify(state.world.parcels, null, 1)) + '</pre>';
    }
    html += '<div class="dbg-row"><span class="dbg-key">altri agenti:</span> ' + state.world.others.length + '</div>';
    html += '</div>';

    html += '<div class="dbg-section">';
    html += '<h3>🎯 Missione</h3>';
    if (!state.mission) {
      html += '<div class="dbg-row"><em>Nessuna missione attiva.</em></div>';
    } else {
      const m = state.mission;
      html += '<div class="dbg-row"><span class="dbg-key">goal:</span> ' + escapeHtml(m.originalGoal) + '</div>';
      html += '<div class="dbg-row"><span class="dbg-key">stato:</span> <span class="badge ' + m.status + '">' + m.status + '</span></div>';
      html += '<div class="dbg-row"><span class="dbg-key">replan:</span> ' + m.replans + '</div>';
      html += '<div class="dbg-row"><span class="dbg-key">step eseguiti:</span> ' + m.totalStepsExecuted + '</div>';
      html += '<div class="dbg-row"><span class="dbg-key">action queue (ultime ' + m.actionQueue.length + '):</span></div>';
      for (const item of [...m.actionQueue].reverse()) {
        html += renderQueueItem(item);
      }
    }
    html += '</div>';

    debugPanel.innerHTML = html;
  }

  async function refreshDebug() {
    try {
      const r = await fetch('/debug');
      if (!r.ok) throw new Error('Fetch failed');
      const state = await r.json();
      renderDebug(state);
    } catch (e) {
      debugPanel.innerHTML = '<div class="error">Errore nel caricare lo stato di debug: ' + escapeHtml(e.message) + '</div>';
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    btn.disabled = true;

    const r = await fetch('/messages');
    const current = await r.json();
    current.push({ role: 'user', content: text });
    render(current);
    setStatus('⏳ sto pensando…');

    try {
      const resp = await fetch('/instruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'HTTP ' + resp.status }));
        throw new Error(err.error);
      }
      await resp.json();
      await refresh();
      await refreshDebug();
    } catch (err) {
      clearStatus();
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = 'Errore: ' + err.message;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  btn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  refresh();
  refreshDebug();
  setInterval(refresh, 3000);
  setInterval(refreshDebug, 1500);
</script>
</body>
</html>`;
    }
}