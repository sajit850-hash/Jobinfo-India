"use client";
import Link from "next/link";
import { useState } from "react";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

type Step = 1 | 2 | 3 | 4 | 5;
const labels = ["Account", "Mobile OTP", "Email OTP", "Profile", "Done"];

export default function CandidateRegister() {
  const [step, setStep] = useState<Step>(1);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [masked, setMasked] = useState("");
  const [email, setEmail] = useState("");

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); setInfo(""); await fn(); setBusy(false); };
  const devHint = (c?: string) => c && setInfo(`Development mode: your code is ${c}`);

  const account = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    return run(async () => {
      const r = await api<{ verificationToken: string; maskedPhone: string; devCode?: string }>("/api/v1/auth/register/candidate", {
        method: "POST",
        body: JSON.stringify({ fullName: f.get("fullName"), email: f.get("email"), phone: f.get("phone"), password: f.get("password"), acceptTerms: f.get("terms") === "on" }),
      });
      if (!r.ok) return setErr(r.data.error ?? "Registration failed");
      setToken(r.data.verificationToken); setMasked(r.data.maskedPhone); setEmail(String(f.get("email"))); devHint(r.data.devCode); setStep(2);
    });
  };

  const verify = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get("code");
    return run(async () => {
      const r = await api("/api/v1/auth/otp/verify", { method: "POST", body: JSON.stringify({ token, code }) });
      if (!r.ok) return setErr(r.data.error ?? "Verification failed");
      setStep(3);
      const mail = await api<{ devCode?: string }>("/api/v1/auth/email/verification/send", { method: "POST", body: "{}" });
      if (!mail.ok) return setErr(mail.data.error ?? "Could not send email verification code");
      setInfo(`A verification code was sent to ${email}.`); devHint(mail.data.devCode); setStep(3);
    });
  };

  const verifyEmail = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get("code");
    return run(async () => {
      const r = await api("/api/v1/auth/email/verification/verify", { method: "POST", body: JSON.stringify({ code }) });
      if (!r.ok) return setErr(r.data.error ?? "Email verification failed");
      setStep(4);
    });
  };

  const resendEmail = () => run(async () => {
    const r = await api<{ devCode?: string }>("/api/v1/auth/email/verification/send", { method: "POST", body: "{}" });
    if (!r.ok) return setErr(r.data.error ?? "Could not resend email code");
    setInfo(`A new code was sent to ${email}.`); devHint(r.data.devCode);
  });

  const resend = () => run(async () => {
    const r = await api<{ devCode?: string }>("/api/v1/auth/otp/resend", { method: "POST", body: JSON.stringify({ token }) });
    if (!r.ok) return setErr(r.data.error ?? "Could not resend");
    setInfo("A new code has been sent."); devHint(r.data.devCode);
  });

  const profile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const exp = String(f.get("experienceYears") ?? "");
    const yr = String(f.get("passingYear") ?? "");
    return run(async () => {
      const r = await api("/api/v1/candidates/me", {
        method: "PUT",
        body: JSON.stringify({
          headline: f.get("headline") || undefined,
          city: f.get("city") || undefined,
          state: f.get("state") || undefined,
          experienceYears: exp === "" ? undefined : Number(exp),
          skills: String(f.get("skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
          education: f.get("institution") && f.get("degree")
            ? [{ institution: f.get("institution"), degree: f.get("degree"), passingYear: yr ? Number(yr) : undefined }]
            : [],
        }),
      });
      if (!r.ok) return setErr(r.data.error ?? "Could not save profile");
      setStep(5);
    });
  };

  return (
    <Page>
      <div className="formPage">
        <div className="steps">
          {labels.map((l, i) => (
            <span key={l} style={{ display: "contents" }}>
              <span className={"on".repeat(step >= i + 1 ? 1 : 0)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="n">{i + 1}</span>{l}
              </span>
              {i < labels.length - 1 && <span className="bar" />}
            </span>
          ))}
        </div>

        <div className="formCard">
          {err && <div className="err">{err}</div>}
          {info && <div className="info">{info}</div>}

          {step === 1 && (<>
            <h1>Create your candidate account</h1>
            <p className="sub">Find jobs and apply in minutes. Free for candidates.</p>
            <form onSubmit={account}>
              <label className="field">Full name<input name="fullName" required minLength={2} placeholder="e.g. Rahul Sharma" /></label>
              <label className="field">Email address<input name="email" type="email" required placeholder="you@example.com" /></label>
              <label className="field">Mobile number<input name="phone" type="tel" required placeholder="+91 98XXXXXXXX" /></label>
              <label className="field">Password<input name="password" type="password" required minLength={8} placeholder="Minimum 8 characters" /></label>
              <label className="check"><input name="terms" type="checkbox" required /> I agree to the Terms and Privacy Policy</label>
              <button className="btn block" disabled={busy}>{busy ? "Please wait..." : "Continue"}</button>
              <button type="button" className="btn outline block" onClick={() => setErr("Google sign-in is not configured yet.")}>Continue with Google</button>
            </form>
            <Link className="altLink" href="/login">Already have an account? Login</Link>
          </>)}

          {step === 2 && (<>
            <h1>Verify your mobile</h1>
            <p className="sub">Enter the 6-digit code sent to {masked}. It expires in 10 minutes.</p>
            <form onSubmit={verify}>
              <label className="field">Verification code<input className="otp" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus /></label>
              <button className="btn block" disabled={busy}>{busy ? "Verifying..." : "Verify"}</button>
            </form>
            <p className="center"><button className="linkBtn" onClick={resend} disabled={busy}>Resend code</button></p>
          </>)}

          {step === 3 && (<>
            <h1>Verify your email</h1>
            <p className="sub">Enter the 6-digit code sent to {email}. It expires in 10 minutes.</p>
            <form onSubmit={verifyEmail}>
              <label className="field">Verification code<input className="otp" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus /></label>
              <button className="btn block" disabled={busy}>{busy ? "Verifying..." : "Verify email"}</button>
            </form>
            <p className="center"><button className="linkBtn" onClick={resendEmail} disabled={busy}>Resend code</button></p>
          </>)}

          {step === 4 && (<>
            <h1>Complete your profile</h1>
            <p className="sub">Add a few details so recruiters can find you. You can edit these later.</p>
            <form onSubmit={profile}>
              <label className="field">Headline<input name="headline" maxLength={120} placeholder="e.g. React Developer" /></label>
              <div className="row2">
                <label className="field">City<input name="city" /></label>
                <label className="field">State<input name="state" /></label>
              </div>
              <label className="field">Years of experience (0 = fresher)<input name="experienceYears" type="number" min={0} max={50} /></label>
              <label className="field">Skills (comma separated)<input name="skills" placeholder="React, Node.js, SQL" /></label>
              <label className="field">College / University<input name="institution" /></label>
              <div className="row2">
                <label className="field">Degree<input name="degree" placeholder="B.Tech" /></label>
                <label className="field">Passing year<input name="passingYear" type="number" min={1970} max={2100} /></label>
              </div>
              <button className="btn block" disabled={busy}>{busy ? "Saving..." : "Finish"}</button>
            </form>
            <p className="center"><button className="linkBtn" onClick={() => setStep(5)}>Skip for now</button></p>
          </>)}

          {step === 5 && (
            <div className="done">
              <div className="tick">✓</div>
              <h1>You&apos;re all set!</h1>
              <p className="sub">Your account is ready. Start exploring jobs.</p>
              <Link className="btn block" href="/jobs">Browse jobs</Link>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
