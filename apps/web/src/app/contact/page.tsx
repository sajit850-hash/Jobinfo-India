import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "Contact Jobinfo India",
  description: "Find the right Jobinfo India account path for candidate, recruiter and institution enquiries.",
};

const paths = [
  ["Candidates", "Create an account to manage your profile and applications, or sign in for candidate support options.", "/register/candidate", "Candidate registration"],
  ["Recruiters", "Register to post jobs and manage applications from your recruiter dashboard.", "/recruiter/register", "Recruiter registration"],
  ["Institutions", "Submit your institution for review and access institution profile tools.", "/institutions/register", "Institution registration"],
];

export default function ContactPage() {
  return <Page><main className="wrap section prosePage">
    <p className="eyebrow">CONTACT</p><h1>How can we help?</h1>
    <p className="lead2">Choose the account path that matches your question. For common questions, visit the FAQs.</p>
    <div className="grid3">{paths.map(([title, body, href, label]) => <article className="card" key={title}><h2>{title}</h2><p className="muted">{body}</p><Link className="textLink" href={href}>{label} →</Link></article>)}</div>
    <p className="note">Need a quick answer? <Link className="textLink" href="/faqs">Read frequently asked questions</Link>.</p>
  </main></Page>;
}
