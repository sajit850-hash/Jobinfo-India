import Link from "next/link";
import { Page } from "@/components/SiteChrome";

const loginTypes = [
  ["Candidate", "Find jobs and manage your applications.", "/candidate/login"],
  ["Recruiter / Employer", "Post roles and manage candidates.", "/recruiter/login"],
  ["Institution", "Manage institution and placement profiles.", "/institution/login"],
  ["Administrator", "Access authorized platform administration.", "/admin/login"],
] as const;

export default function Login() {
  return (
    <Page>
      <main className="wrap section">
        <p className="eyebrow">WELCOME BACK</p>
        <h1>Choose your account</h1>
        <p className="sub">Select the account type you use to sign in.</p>
        <div className="grid2 loginOptions">
          {loginTypes.map(([title, description, href]) => (
            <Link className="card cat" href={href} key={href}>
              <b>{title}</b><span>{description}</span><span>Continue to login →</span>
            </Link>
          ))}
        </div>
        <p className="center">New to Jobinfo India? <Link href="/register">Create an account</Link></p>
      </main>
    </Page>
  );
}
