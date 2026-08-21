// webchat.js
import http from 'http';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WebChat</title>
  <style>
    body { font-family: monospace; display: flex; flex-direction: column; height: 100vh; margin: 0; }
    #messages { flex: 1; overflow-y: auto; padding: 10px; }
    .user  { color: #222; }
    .agent { color: #4a90d9; white-space: pre-wrap; margin: 4px 0; }
    #inputBar { display: flex; border-top: 1px solid #ccc; }
    #textInput { flex: 1; padding: 10px; font-size: 16px; border: none; outline: none; }
    #sendBtn { padding: 10px 20px; border: none; background: #4a90d9; color: white; cursor: pointer; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="inputBar">
    <input id="textInput" type="text" placeholder="Type a message..." />
    <button id="sendBtn">Send</button>
  </div>

  <script>
    const messages = document.getElementById('messages');
    const input = document.getElementById('textInput');
    const btn = document.getElementById('sendBtn');

    function addMessage(text, cls) {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    const events = new EventSource('/events');
    events.onmessage = (e) => {
      addMessage(e.data.replace(/\\\\n/g, '\\n'), 'agent');
    };

    async function send() {
      const text = input.value.trim();
      if (!text) return;

      input.value = '';

      try {
        const res = await fetch('/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          addMessage('🧑 ' + text, 'user');
        } else {
          addMessage('[error sending message]', 'agent');
        }
      } catch (e) {
        addMessage('[error: ' + e.message + ']', 'agent');
      }
    }

    btn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
  </script>
</body>
</html>`;

export function startWebChat(onMessage) {
    const sseClients = [];

    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
            return;
        }

        if (req.method === 'GET' && req.url === '/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write('\n');
            sseClients.push(res);

            req.on('close', () => {
                const idx = sseClients.indexOf(res);
                if (idx >= 0) sseClients.splice(idx, 1);
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/message') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                try {
                    const { text } = JSON.parse(body);
                    if (typeof text === 'string' && text.length > 0) {
                        onMessage(text);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    });

    server.listen(8081, () => {
        console.log('WebChat running at http://localhost:8081');
    });

    function sendReply(text) {
        const payload = String(text).replace(/\n/g, '\\n');
        for (const client of sseClients) {
            client.write(`data: ${payload}\n\n`);
        }
    }

    return { server, sendReply };
}