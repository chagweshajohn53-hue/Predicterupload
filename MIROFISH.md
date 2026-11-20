# Connect MiroFish to FreeFlow

Publish the relay changes before using these URLs outside the preview.

- API base URL: `https://freeflow-model-relay.lovable.app/v1`
- Chat endpoint: `POST https://freeflow-model-relay.lovable.app/v1/chat/completions`
- Model list: `GET https://freeflow-model-relay.lovable.app/v1/models`
- Authentication: `Authorization: Bearer YOUR_EXISTING_FREEFLOW_TOKEN`
- Recommended model: `freeflow` (uses your saved enabled provider order).
- Streaming: not supported by this endpoint; set `stream: false`. The existing playground's streaming is unchanged.

If published-site access restrictions intercept `/v1`, use the externally accessible base URL `https://freeflow-model-relay.lovable.app/api/public/v1`. It has identical `/chat/completions` and `/models` handlers and still requires your personal token.

## Models

`GET /v1/models` is the authoritative list for your account: it returns `freeflow` plus enabled models with configured provider keys. A selected model is attempted first, then the rest of your configured chain. Provider availability, quotas, and access still apply; being listed is not a guarantee of provider service.

Default configured model names:

- `llama-3.3-70b-versatile`
- `gemini-2.5-flash`
- `meta-llama/llama-3.3-70b-instruct:free`
- `deepseek/deepseek-chat-v3-0324:free`
- `deepseek-ai/DeepSeek-V3-0324`
- `Qwen/Qwen2.5-72B-Instruct`
- `qwen/qwen-2.5-72b-instruct:free`
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

## Sample request

Store your existing token securely as `FREEFLOW_API_TOKEN`; do not paste it into public source code.

```bash
curl https://freeflow-model-relay.lovable.app/v1/chat/completions \
  -H "Authorization: Bearer $FREEFLOW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"freeflow","messages":[{"role":"system","content":"You are a research assistant."},{"role":"user","content":"Summarize the key arguments in this discussion."}],"temperature":0.7,"max_tokens":512,"stream":false}'
```

Send the full conversation on every request, including system prompts. FreeFlow preserves that history across provider attempts; it does not store a separate conversation for the external application.

Supported request fields: `model`, `messages` (system/user/assistant with text content), `temperature`, `max_tokens`, and `stream: false`. Tool calling and other OpenAI features are not implemented. Responses include standard completion fields and provider usage when available (zero when not reported).

Existing `/api/public/v1/generate` chat, image, and video requests remain available. No tokens or provider keys are changed by this integration.