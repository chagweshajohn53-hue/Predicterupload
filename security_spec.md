# Security Specification & Dirty Dozen Audit

## 1. Data Invariants
1. Every document in `/vaults/{userId}` belongs strictly to the authenticated user whose `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. `userId` and `createdAt` are immutable after document creation.
3. `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
4. `keys` only permits known fields (`groq`, `gemini`, `openrouter`, `cfAccount`, `cfToken`, `apiToken`, `zep`, `anthropic`, `extra`), each bounded in length (`<= 512`), with `extra` bounded to at most 10 backup entries.
5. `chain` is bounded to at most 50 entries and its elements conform to supported providers (`groq`, `gemini`, `openrouter`, `cloudflare`).
6. Collection-wide listing (`allow list`) on `/vaults` is unconditionally denied.

## 2. Dirty Dozen Attack Payloads (All Expected: PERMISSION_DENIED)
1. **Unauthenticated read**: `GET /vaults/uid123` with `auth = null`.
2. **Cross-user read (PII/Secret leak)**: `GET /vaults/victimUid` as `attackerUid`.
3. **Collection listing scrape**: `LIST /vaults` as any authenticated user.
4. **Unverified email write**: `CREATE /vaults/uid123` with `email_verified = false`.
5. **Identity spoofing**: `CREATE /vaults/uid123` as `attackerUid` with `userId = "uid123"` or `CREATE /vaults/attackerUid` with `userId = "victimUid"`.
6. **ID poisoning**: `CREATE /vaults/bad$id..with/chars` or >128 chars.
7. **Shadow/Ghost field injection**: `CREATE` or `UPDATE /vaults/uid123` including `isAdmin: true` or `role: "admin"`.
8. **Missing required fields**: `UPDATE` or `CREATE /vaults/uid123` omitting `chain` or `updatedAt`.
9. **Immutable field mutation**: `UPDATE /vaults/uid123` modifying `userId` or `createdAt`.
10. **Client timestamp forgery**: `CREATE` or `UPDATE /vaults/uid123` setting `updatedAt` to an arbitrary past/future timestamp instead of `request.time`.
11. **Oversized array / DoW payload**: `CREATE` or `UPDATE /vaults/uid123` with `chain.size() > 50` or a `keys.groq` string `> 512` chars.
12. **Unsupported provider injection**: `CREATE` or `UPDATE /vaults/uid123` with `chain[0].provider == "huggingface"`.
