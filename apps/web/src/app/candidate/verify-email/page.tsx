"use client";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";

export default function VerifyCandidateEmail() {
  return <Page><main className="formPage"><section className="formCard">
    <p className="eyebrow">CANDIDATE ACCOUNT</p><h1>Email verification is not required</h1><p className="sub">You can continue to your candidate dashboard and use your account normally.</p>
    <Link className="btn block" href="/candidate/dashboard">Go to dashboard</Link>
  </section></main></Page>;
}
