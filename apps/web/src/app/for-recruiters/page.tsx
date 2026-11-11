import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "Recruiter hiring tools",
  description: "Post jobs, review applications and connect with candidates on Jobinfo India.",
};

const benefits = [
  ["Publish job openings", "Create job posts and submit them for review before they appear to candidates."],
  ["Manage applicants", "Review applications and track each candidate through your hiring process."],
  ["Choose your recruiter plan", "Compare freelance and corporate plans before deciding what fits your team."],
];

export default function ForRecruitersPage() {
  return <Page><main className="wrap section">
    <section className="recruiterHero"><p className="eyebrow">FOR RECRUITERS</p><h1>Meet your next great hire</h1>
      <p className="lead2">Bring your openings and applicant workflow together, from job post to application review.</p>
      <div className="heroActions"><Link className="btn" href="/recruiter/register">Create recruiter account</Link><Link className="btn outline" href="/pricing">View plans</Link></div>
    </section>
    <section className="section"><h2>Tools for your hiring workflow</h2><div className="grid3">{benefits.map(([title, body]) => <article className="card" key={title}><h3>{title}</h3><p className="muted">{body}</p></article>)}</div></section>
    <p className="note">Job postings are reviewed before publication. A recruiter account does not represent a guarantee of candidate volume or hiring outcomes.</p>
  </main></Page>;
}
