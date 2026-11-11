"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr("");
    const f = new FormData(e.currentTarget);
    const r = await api<{ role: string; emailVerified: boolean }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });
    setBusy(false);
    if (!r.ok) return setErr(r.data.error ?? "Login failed");
    router.push(r.data.role === "ADMIN" ? "/admin/dashboard" : r.data.role === "RECRUITER" ? "/recruiter/dashboard" : r.data.role === "INSTITUTION" ? "/institution/dashboard" : r.data.emailVerified === false ? "/candidate/verify-email" : "/candidate/dashboard");
    router.refresh();
  }

  return (
    <Page>
      <div className="formPage"><div className="formCard">
        <h1>Login to Jobinfo India</h1>
        <p className="sub">Welcome back.</p>
        {err && <div className="err">{err}</div>}
        <form onSubmit={submit}>
          <label className="field">Email address<input name="email" type="email" required placeholder="you@example.com" /></label>
          <label className="field">Password<input name="password" type="password" required /></label>
          <button className="btn block" disabled={busy}>{busy ? "Signing in..." : "Login"}</button>
        </form>
        <Link className="altLink" href="/register/candidate">New here? Create an account</Link>
        <Link className="altLink" href="/account/security">Forgot password or need account help?</Link>
      </div></div>
    </Page>
  );
}
