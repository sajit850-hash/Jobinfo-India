import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "About Jobinfo India",
  description: "Learn about Jobinfo India's job search, recruiter and institution directory platform.",
};

export default function AboutPage() {
  return <Page><main className="wrap section prosePage">
    <p className="eyebrow">ABOUT US</p><h1>Connecting India's job seekers and employers</h1>
    <p className="lead2">Jobinfo India brings job discovery, recruiter tools and institution listings together in one place.</p>
    <section className="card"><h2>Our focus</h2><p>We aim to make it easier for candidates to explore opportunities, for recruiters to manage job applications, and for institutions to share their presence with the wider employment community.</p><p>Job listings and employer details can change. Candidates should confirm role details with the employer before sharing sensitive information or making career decisions.</p></section>
    <div className="heroActions"><Link className="btn" href="/jobs">Explore jobs</Link><Link className="btn outline" href="/for-recruiters">For recruiters</Link></div>
  </main></Page>;
}
