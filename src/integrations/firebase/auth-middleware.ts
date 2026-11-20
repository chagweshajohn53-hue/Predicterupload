import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import firebaseConfig from "../../../firebase-applet-config.json";

type VerifiedToken = {
  uid: string;
  email: string | null;
  email_verified?: boolean;
};

type JwkKey = JsonWebKey & { kid?: string };

let cachedJwks: { keys: JwkKey[]; expiresAt: number } | null = null;

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const bytes = base64UrlToUint8Array(segment);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function fetchFirebaseJwks(forceRefresh = false): Promise<JwkKey[]> {
  if (!forceRefresh && cachedJwks && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;
  const res = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!res.ok) throw new Error(`Failed to fetch Firebase public keys (${res.status})`);
  const data = (await res.json()) as { keys?: JwkKey[] };
  const keys = data.keys ?? [];
  const cc = res.headers.get("cache-control") ?? "";
  const maxAgeMatch = cc.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3_600_000;
  cachedJwks = { keys, expiresAt: Date.now() + ttlMs };
  return keys;
}

async function verifyWithWebCrypto(token: string): Promise<VerifiedToken> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Unauthorized: Malformed Firebase token");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
  }>(payloadB64);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Unauthorized: Invalid Firebase token header");
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== firebaseConfig.projectId) {
    throw new Error("Unauthorized: Invalid Firebase token audience");
  }
  if (payload.iss !== `https://securetoken.google.com/${firebaseConfig.projectId}`) {
    throw new Error("Unauthorized: Invalid Firebase token issuer");
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Unauthorized: Invalid Firebase user");
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new Error("Unauthorized: Expired Firebase token");
  }
  if (typeof payload.iat !== "number" || payload.iat > now + 300) {
    throw new Error("Unauthorized: Invalid Firebase token issued-at time");
  }
  if (typeof payload.auth_time === "number" && payload.auth_time > now + 300) {
    throw new Error("Unauthorized: Invalid Firebase token auth_time");
  }

  let jwks = await fetchFirebaseJwks();
  let jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) {
    jwks = await fetchFirebaseJwks(true);
    jwk = jwks.find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    throw new Error("Unauthorized: Unknown Firebase signing key");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBytes = base64UrlToUint8Array(sigB64);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sigBytes as BufferSource, dataBytes);
  if (!ok) {
    throw new Error("Unauthorized: Invalid Firebase token signature");
  }

  return {
    uid: payload.sub,
    email: payload.email ?? null,
    ...(payload.email_verified !== undefined ? { email_verified: payload.email_verified } : {}),
  };
}

async function verifyFirebaseToken(token: string): Promise<VerifiedToken> {
  const isCloudflareWorker =
    typeof navigator !== "undefined" && /Cloudflare-Workers/i.test(navigator.userAgent);
  if (
    isCloudflareWorker ||
    (!process.env["GOOGLE_APPLICATION_CREDENTIALS"] &&
      !process.env["FIREBASE_CONFIG"] &&
      !process.env["K_SERVICE"])
  ) {
    return verifyWithWebCrypto(token);
  }
  try {
    const { getApp, getApps, initializeApp } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const app = getApps().length ? getApp() : initializeApp({ projectId: firebaseConfig.projectId });
    const decoded = await getAuth(app).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      ...(decoded.email_verified !== undefined ? { email_verified: decoded.email_verified } : {}),
    };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (typeof code === "string" && code.startsWith("auth/")) {
      throw err;
    }
    return verifyWithWebCrypto(token);
  }
}

export async function verifyFirebaseRequest(request: Request | undefined): Promise<{ userId: string; email: string | null }> {
  const authHeader = request?.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized: Missing Firebase Bearer token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("Unauthorized: Empty Firebase token");
  }

  const decoded = await verifyFirebaseToken(token);
  if (!decoded.uid) {
    throw new Error("Unauthorized: Invalid Firebase user");
  }
  if (decoded.email_verified !== true) {
    throw new Error("Unauthorized: Verified email account required");
  }

  return {
    userId: decoded.uid,
    email: decoded.email ?? null,
  };
}

export const requireFirebaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const context = await verifyFirebaseRequest(getRequest());
  return next({ context });
});
