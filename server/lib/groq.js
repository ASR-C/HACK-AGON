/* Groq chat completions — powers the AI coach (hints, mistake explanations).
   Uses global fetch, no SDK, so there is nothing extra to install. */

const config = require("../config");

const URL = "https://api.groq.com/openai/v1/chat/completions";

const configured = () => !!config.groq.key;

async function chat(messages, opts = {}) {
  if (!configured()) {
    const err = new Error("GROQ_API_KEY is not set on the server.");
    err.status = 503;
    throw err;
  }
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groq.key}`
    },
    body: JSON.stringify({
      model: opts.model || config.groq.model,
      messages,
      temperature: opts.temperature === undefined ? 0.4 : opts.temperature,
      // Reasoning models spend part of max_tokens thinking, so leave headroom.
      max_tokens: opts.maxTokens || 1500
    }),
    signal: AbortSignal.timeout(opts.timeoutMs || 30000)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Groq responded ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status === 401 || res.status === 403 ? 502 : 502;
    throw err;
  }
  const data = await res.json();
  const choice = (data.choices || [])[0] || {};
  return {
    text: (choice.message && choice.message.content || "").trim(),
    model: data.model,
    usage: data.usage || null
  };
}

module.exports = { chat, configured, URL };
