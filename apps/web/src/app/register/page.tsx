import Link from "next/link";
import { Page } from "@/components/SiteChrome";

export default function Register() {
  return (
    <Page>
      <section className="wrap section">
        <p className="eyebrow">JOIN JOBINFO INDIA</p>
        <h1 style={{ fontSize: 32, marginBottom: 20 }}>Create your account</h1>
        <div className="grid3">
          <Link className="card cat" href="/register/candidate"><b>Candidate</b><span>Create profile and apply →</span></Link>
          <Link className="card cat" href="/recruiter/register"><b>Recruiter / Employer</b><span>Post jobs and manage applicants →</span></Link>
          <Link className="card cat" href="/institutions"><b>Institution</b><span>Showcase your campus →</span></Link>
        </div>
      </section>
    </Page>
  );
}
