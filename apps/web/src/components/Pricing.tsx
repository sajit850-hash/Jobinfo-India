"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plan, corporatePlans, freelancePlans, institutionPlans } from "@/lib/plans";
import { api } from "@/lib/api";

type PublicPlan = { code: string; audience: string; name: string; description?: string | null; amountPaise: number; durationDays: number; features: string[] };
type DisplayPlan = { name: string; amountPaise: number; durationDays: number; features: string[]; featured?: boolean };

function Cards({ plans, href }: { plans: DisplayPlan[]; href: string }) {
  return <div className="planGrid">{plans.map((plan) => <article key={plan.name} className={`plan${plan.featured ? " hot" : ""}`}>
    <span className="planName">{plan.name}</span>
    <div className="price">₹{(plan.amountPaise / 100).toLocaleString("en-IN")}{plan.amountPaise > 0 && <small> / {plan.durationDays === 365 ? "year" : plan.durationDays === 30 ? "month" : `${plan.durationDays} days`} + applicable tax</small>}</div>
    <ul>{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
    <Link className={`btn block${plan.featured ? "" : " outline"}`} href={href}>View plans</Link>
  </article>)}</div>;
}

function fallback(plans: Plan[], durationDays = 30): DisplayPlan[] {
  return plans.map((plan) => ({ name: plan.name, amountPaise: plan.price * 100, durationDays, features: plan.features, featured: plan.featured }));
}

export function Pricing() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void api<{ data: PublicPlan[] }>("/api/v1/billing/plans").then((result) => {
      if (active && result.ok) { setPlans(result.data.data); setLoaded(true); }
    });
    return () => { active = false; };
  }, []);

  const byAudience = (audience: string, defaults: DisplayPlan[]) => loaded
    ? plans.filter((plan) => plan.audience === audience).map((plan) => ({ name: plan.name, amountPaise: plan.amountPaise, durationDays: plan.durationDays, features: plan.features }))
    : defaults;
  const freelance = byAudience("FREELANCE", fallback(freelancePlans));
  const corporate = byAudience("CORPORATE", fallback(corporatePlans));
  const institutions = byAudience("INSTITUTION", fallback(institutionPlans, 365));

  return <section className="soft" id="pricing"><div className="wrap section">
    <h2 className="center">Plans for every hiring team</h2>
    <p className="center muted">Pricing and plan limits are managed by Jobinfo India. Applicable GST is calculated at checkout.</p>
    <h3 className="planHead">Freelance Recruiters <span className="pill">Recruiter account</span></h3>
    {freelance.length ? <Cards plans={freelance} href="/recruiter/register?type=freelance" /> : <p className="muted">No freelance plans are currently available.</p>}
    <h3 className="planHead">Corporate Recruiters <span className="pill">Company account</span></h3>
    {corporate.length ? <Cards plans={corporate} href="/recruiter/register?type=corporate" /> : <p className="muted">No corporate plans are currently available.</p>}
    <h3 className="planHead">Institutions &amp; Colleges <span className="pill">Placement workspace</span></h3>
    {institutions.length ? <Cards plans={institutions} href="/institutions/register" /> : <p className="muted">No institution plans are currently available.</p>}
  </div></section>;
}
