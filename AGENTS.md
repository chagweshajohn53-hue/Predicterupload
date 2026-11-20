<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Rules
- Prediction bookends use authenticated server-side Claude Haiku calls; failed Claude reads/reviews stop the prediction rather than silently substituting a debate model. Successful picture descriptions use bounded in-memory caching.
- Generation logic shared by the browser and the hosted API lives in `src/lib/hub.ts` and takes a fetcher, so one model list and failover loop serve both.
- `/api/public/v1/generate` authenticates callers by the personal `apiToken` stored in their saved settings; it must never respond without a matching token.
- Hosted chat endpoints share `runHostedChat` in `hub.ts` and the media failover loop; adapters must preserve the entire messages array and never return raw upstream errors.
- OpenAI routes use shared request handlers and a server-only saved-token lookup, with `/api/public/v1` aliases for external callers when published-site access gates `/v1`.
- The MiroFish-style Swarm simulator runs in the browser (`src/lib/swarm.ts`) on the existing chat failover, so every LLM step inherits the Router chain; Zep graph memory is optional, keyed from the user's vault and reached through the relay allowlist.
- `/api/public/v1/predict` runs the Swarm server-side (`src/lib/predict.ts`) on `runHostedChat`, so external bots get debate-based signals with the same token auth and failover.
- Claude credentials are read only inside authenticated handlers, and the shared fetch-based Claude adapter accepts the credential as an argument so browser bundles never receive it.
- Saved vaults are normalized on local load and cloud read to strip unsupported providers and keys without changing retained model priority.
