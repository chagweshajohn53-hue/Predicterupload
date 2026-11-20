import { Component, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { connectCloud, disconnectCloud } from "@/lib/vault";

class VaultErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center px-4">
          <div className="w-full max-w-md space-y-3 rounded-lg border border-destructive/50 bg-card p-6">
            <h1 className="font-mono text-sm font-semibold text-destructive">Connection or permission error</h1>
            <p className="break-words font-mono text-xs text-muted-foreground">{this.state.error.message}</p>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              className="rounded-md bg-primary px-3 py-2 font-mono text-xs uppercase text-primary-foreground"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "in" | "out">("loading");
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        disconnectCloud();
        setSyncError("");
        setStatus("out");
        return;
      }
      setSyncError("");
      void connectCloud(user.uid)
        .then(() => setStatus("in"))
        .catch((err) => {
          setSyncError(err instanceof Error ? err.message : String(err));
          setStatus("in");
        });
    });
    return () => unsubscribe();
  }, []);

  if (status === "loading") {
    return <div className="grid min-h-screen place-items-center font-mono text-xs text-muted-foreground">unlocking…</div>;
  }
  if (status === "out") return <SignIn />;
  return (
    <VaultErrorBoundary>
      {syncError && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 font-mono text-xs text-destructive">
          Firestore sync warning: {syncError}
        </div>
      )}
      {children}
    </VaultErrorBoundary>
  );
}

function SignIn() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setErr("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed";
      if (/popup-closed-by-user/i.test(msg)) {
        setErr("Sign-in popup was closed before completing.");
      } else if (/popup-blocked/i.test(msg)) {
        setErr("Browser blocked the Google sign-in popup. Allow popups for this site and retry.");
      } else if (/unauthorized-domain/i.test(msg)) {
        const host = typeof window !== "undefined" ? window.location.hostname : "this domain";
        setErr(`Domain "${host}" is not authorized in Firebase Authentication. Add it under Authentication → Settings → Authorized domains.`);
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="font-mono text-sm font-semibold">
          failover<span className="text-primary">/</span>relay — locked
        </h1>
        <p className="text-xs text-muted-foreground">
          Sign in with Google to unlock your Firebase-synced API vault, failover chain, and Claude Haiku 5.5 market simulator.
        </p>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => void signIn()}
          className="w-full rounded-md bg-primary px-3 py-2 font-mono text-xs uppercase text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Continue with Google"}
        </button>
      </div>
    </div>
  );
}

export function SignOutButton() {
  const userEmail = auth.currentUser?.email;
  return (
    <div className="flex items-center gap-2">
      {userEmail && <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">{userEmail}</span>}
      <button
        onClick={() => void signOut(auth)}
        className="rounded-md px-3 py-1.5 font-mono text-xs uppercase text-muted-foreground hover:text-foreground"
      >
        Lock
      </button>
    </div>
  );
}
