// ollama.js
// Minimal client for a local Ollama instance (http://localhost:11434).

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:26b';
export const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 32768);
export const OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE ?? 0.9);

/**
 * Sends a prompt to the local Ollama server and returns the model's reply.
 * The model is expected to respond with a JSON string (in message.content)
 * shaped as { plan: [...], chat: "..." } — parsed downstream by parser.js.
 *
 * @param {string} text
 * @returns {Promise<{ message: object, promptTokens: number, replyTokens: number }>}
 */
export async function queryOllama(text) {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [{ role: 'user', content: text }],
            format: 'json',
            stream: false,
            options: {
                num_ctx: OLLAMA_NUM_CTX,
                temperature: OLLAMA_TEMPERATURE,
            },
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ollama request failed (${res.status}): ${errText}`);
    }

    const data = await res.json();

    return {
        message: data.message ?? { role: 'assistant', content: '' },
        promptTokens: data.prompt_eval_count ?? 0,
        replyTokens: data.eval_count ?? 0,
    };
}