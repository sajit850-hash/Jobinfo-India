"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type PublicPlan = { code: string; audience: string; name: string; description?: string | null; amountPaise: number; originalAmountPaise?: number; planDiscountPaise?: number; durationDays: number; billingCycle?: string; features: (string | { key: string; name: string; enabled?: boolean; visible?: boolean })[]; featured?: boolean; recommended?: boolean; customBadge?: string | null };
function Cards({ plans, href }: { plans: PublicPlan[]; href: string }) {
  return <div className="planGrid">{plans.map((plan) => <article key={plan.code} className={`plan${plan.featured || plan.recommended ? " hot" : ""}`}>
    {(plan.customBadge || plan.recommended) && <span className="pill">{plan.customBadge || "Recommended"}</span>}
    <span className="planName">{plan.name}</span>
    <div className="price">₹{(plan.amountPaise / 100).toLocaleString("en-IN")}{plan.amountPaise > 0 && <small> / {plan.billingCycle?.toLowerCase().replaceAll("_", " ") || `${plan.durationDays} days`} + applicable tax</small>}</div>
    {plan.planDiscountPaise ? <p className="muted"><s>₹{((plan.originalAmountPaise || plan.amountPaise + plan.planDiscountPaise) / 100).toLocaleString("en-IN")}</s> · limited time</p> : null}
    {plan.description && <p className="muted">{plan.description}</p>}
    <ul>{plan.features.filter(feature => typeof feature === "string" || (feature.enabled !== false && feature.visible !== false)).map((feature, index) => <li key={typeof feature === "string" ? feature : feature.key}>✓ {typeof feature === "string" ? feature : feature.name}</li>)}</ul>
    <Link className={`btn block${plan.featured || plan.recommended ? "" : " outline"}`} href={href}>View plans</Link>
  </article>)}</div>;
}

export function Pricing() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ data: PublicPlan[] }>("/api/v1/billing/plans").then((result) => {
      if (!active) return;
      setLoaded(true);
      if (result.ok) setPlans(result.data.data); else setError("Pricing is temporarily unavailable.");
    });
    return () => { active = false; };
  }, []);

  const section = (audience: string, title: string, label: string, href: string) => {
    const rows = plans.filter(plan => plan.audience === audience);
    return <><h3 className="planHead">{title} <span className="pill">{label}</span></h3>{rows.length ? <Cards plans={rows} href={href} /> : <p className="muted">No {title.toLowerCase()} are currently available.</p>}</>;
  };
  return <section className="soft" id="pricing"><div className="wrap section">
    <h2 className="center">Plans for every hiring team</h2>
    <p className="center muted">Plan prices and features are managed by Jobinfo India. Applicable GST is calculated at checkout.</p>
    {error && <p className="err center">{error}</p>}
    {!loaded ? <p className="muted center">Loading current plans…</p> : <>
      {section("FREELANCE", "Freelance Recruiters", "Recruiter account", "/recruiter/register?type=freelance")}
      {section("CORPORATE", "Corporate Recruiters", "Company account", "/recruiter/register?type=corporate")}
      {section("INSTITUTION", "Institutions & Colleges", "Placement workspace", "/institutions/register")}
    </>}
  </div></section>;
}
