# MiroFish integration
- [ ] Connect authenticated Claude Haiku picture reading and final review in both prediction paths, remove Hugging Face, and verify live handoffs.
- [x] Optimize chart preparation, vision-only routing, successful-description caching, and upload errors; verify real upload (0.08s) and chart extraction, plus regression tests.
- [ ] Complete live simulation and image follow-up verification — blocked: saved vision providers became unavailable during verification; an earlier run read the chart but persona JSON failed. Corrected malformed JSON examples; requires restored provider access for live recheck.
- [x] Reuse saved-token authentication and existing failover for OpenAI chat completions.
- [x] Add chat and model-list endpoints, retaining the generate endpoint.
- [x] Test authentication, history preservation, options, failover, and error safety (17 tests; real saved-token chat and existing generate both returned 200).
- [x] Provide integration details in Export and MIROFISH.md, including publication and restricted-site URL alternatives.