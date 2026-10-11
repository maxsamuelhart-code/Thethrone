import { useState, type ReactNode } from "react";
import { FEATURE_LABELS, PLAN_FEATURES, type Feature, type Me } from "@seedscout/shared";
import { api } from "../api";

function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function UpgradeModal({ me, feature, onClose, onLogin }: { me: Me; feature?: Feature; onClose(): void; onLogin(): void }) {
  const [busy, setBusy] = useState(false);
  async function checkout(interval: "month" | "year") {
    if (!me.user) return onLogin();
    setBusy(true);
    try {
      // Stripe-hosted checkout on the web: no app-store billing involved.
      const { url } = await api<{ url: string }>("/billing/checkout", { body: { interval } });
      window.location.href = url;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="SeedScout Pro" onClose={onClose}>
      {feature && <p className="muted">{FEATURE_LABELS[feature]} is a Pro feature.</p>}
      <ul className="features">
        {PLAN_FEATURES.pro.map((f) => (
          <li key={f} className={PLAN_FEATURES.free.includes(f) ? "muted" : ""}>✓ {FEATURE_LABELS[f]}</li>
        ))}
      </ul>
      <div className="plans">
        <button className="btn primary block" disabled={busy} onClick={() => checkout("year")}>Yearly · best value</button>
        <button className="btn block" disabled={busy} onClick={() => checkout("month")}>Monthly</button>
      </div>
      <p className="muted small">Cancel anytime. Prices shown at checkout.</p>
    </Modal>
  );
}

export function LoginModal({ onClose }: { onClose(): void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api<{ ok: true; devLink?: string }>("/auth/login", { body: { email } });
      setSent(r.devLink ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }
  return (
    <Modal title="Sign in" onClose={onClose}>
      {sent === null ? (
        <form onSubmit={submit} className="login">
          <input type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary block">Email me a sign-in link</button>
          {error && <p className="error">{error}</p>}
        </form>
      ) : (
        <>
          <p>Check your inbox for a sign-in link.</p>
          {sent && <p className="small">Dev mode: <a href={sent}>open sign-in link</a></p>}
        </>
      )}
    </Modal>
  );
}

export function AccountModal({ me, onClose }: { me: Me; onClose(): void }) {
  const portal = async () => (window.location.href = (await api<{ url: string }>("/billing/portal", { method: "POST" })).url);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.reload();
  };
  return (
    <Modal title="Account" onClose={onClose}>
      <p>{me.user?.email}</p>
      <p className="muted">
        Plan: <b>{me.plan === "pro" ? "Pro" : "Free"}</b>
        {me.subscription?.cancelAtPeriodEnd && ` · ends ${new Date(me.subscription.currentPeriodEnd).toLocaleDateString()}`}
      </p>
      {me.subscription && <button className="btn block" onClick={portal}>Manage subscription</button>}
      <button className="btn ghost block" onClick={logout}>Sign out</button>
    </Modal>
  );
}
