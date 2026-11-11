"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function VerifyCandidateEmail() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setError(""); setMessage("");
    const r = await api<{devCode?:string}>("/api/v1/auth/email/verification/send", { method: "POST", body: "{}" });
    setBusy(false);
    if (!r.ok) setError(r.data.error || "Could not send the verification code");
    else setMessage(r.data.devCode ? `Development mode: your code is ${r.data.devCode}` : "A new verification code has been sent to your email.");
  };
  const verify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const code = new FormData(event.currentTarget).get("code");
    const r = await api("/api/v1/auth/email/verification/verify", { method: "POST", body: JSON.stringify({ code }) });
    setBusy(false);
    if (!r.ok) setError(r.data.error || "Email verification failed");
    else router.push("/candidate/dashboard");
  };
  return <Page><main className="formPage"><section className="formCard">
    <p className="eyebrow">CANDIDATE ACCOUNT</p><h1>Verify your email</h1><p className="sub">Enter the 6-digit code sent to your registered email address.</p>
    {error && <div className="err">{error}</div>}{message && <div className="info">{message}</div>}
    <form onSubmit={verify}><label className="field">Verification code<input className="otp" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></label><button className="btn block" disabled={busy}>{busy ? "Please wait…" : "Verify email"}</button></form>
    <p className="center"><button className="linkBtn" type="button" onClick={send} disabled={busy}>Send or resend code</button></p>
  </section></main></Page>;
}
