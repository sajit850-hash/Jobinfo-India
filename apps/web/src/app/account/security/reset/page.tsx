"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function ResetPassword() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await api("/api/v1/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ token, newPassword: form.get("newPassword") }),
    });
    setBusy(false);
    if (!result.ok) setError(result.data.error || "Could not reset your password.");
    else {
      setToken("");
      setMessage("Your password has been reset. Sign in with your new password.");
    }
  }

  return <Page><main className="formPage"><section className="formCard">
    <p className="eyebrow">ACCOUNT SECURITY</p>
    <h1>Reset your password</h1>
    <p className="sub">Choose a new password with at least 12 characters.</p>
    {error && <div className="err" role="alert">{error}</div>}
    {message && <div className="info" role="status">{message}</div>}
    {!message && <form onSubmit={submit}>
      <label className="field">New password<input name="newPassword" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>
      <button className="btn block" disabled={busy || !token}>{busy ? "Updating…" : "Reset password"}</button>
      {!token && <p className="err" role="alert">This reset link is invalid or expired. Request a new one.</p>}
    </form>}
    <Link className="altLink" href="/login">Return to login</Link>
  </section></main></Page>;
}
