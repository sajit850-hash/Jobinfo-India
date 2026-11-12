"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

type LoginRole = "CANDIDATE" | "RECRUITER" | "INSTITUTION" | "ADMIN";

const roleDetails: Record<LoginRole, { title: string; dashboard: string }> = {
  CANDIDATE: { title: "Candidate", dashboard: "/candidate/dashboard" },
  RECRUITER: { title: "Recruiter / Employer", dashboard: "/recruiter/dashboard" },
  INSTITUTION: { title: "Institution", dashboard: "/institution/dashboard" },
  ADMIN: { title: "Administrator", dashboard: "/admin/dashboard" },
};

export function LoginForm({ role }: { role: LoginRole }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const detail = roleDetails[role];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ role: LoginRole }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          password: form.get("password"),
          expectedRole: role,
        }),
      });
      if (!result.ok) {
        setError(result.data.error || "Unable to sign in. Check your details and try again.");
        return;
      }
      router.push(detail.dashboard);
      router.refresh();
    } catch {
      setError("Unable to reach the sign-in service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <main className="formPage">
        <section className="formCard" aria-labelledby="login-heading">
          <p className="eyebrow">{detail.title.toUpperCase()} SIGN IN</p>
          <h1 id="login-heading">Login to Jobinfo India</h1>
          <p className="sub">Sign in to your {detail.title.toLowerCase()} account.</p>
          {error && <div className="err" role="alert">{error}</div>}
          <form onSubmit={submit}>
            <label className="field" htmlFor="login-email">
              Email address
              <input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} />
            </label>
            <label className="field" htmlFor="login-password">
              Password
              <span className="passwordInput">
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={128} />
                <button
                  type="button"
                  className="passwordToggle"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            <button className="btn block" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Login"}
            </button>
          </form>
          <Link className="altLink" href="/account/security">Forgot password?</Link>
          <Link className="altLink" href="/login">Choose a different account type</Link>
          <Link className="altLink" href="/register">Create an account</Link>
        </section>
      </main>
    </Page>
  );
}
