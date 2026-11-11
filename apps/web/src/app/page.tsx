import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { Pricing } from "@/components/Pricing";
import { API_SERVER as API, Job, expLabel, salaryLabel } from "@/lib/api";

export const dynamic = "force-dynamic";

// Category counts and hero stats are placeholders from the prototype until real data exists.
const categories = [
  ["IT & Software", "12,400"], ["Sales & Marketing", "8,900"], ["Banking & Finance", "5,200"],
  ["Healthcare", "4,100"], ["Education", "3,600"], ["HR & Admin", "2,800"],
];
const popular = ["Software Developer", "Sales Executive", "Accountant", "HR Recruiter", "Remote"];
const stats = [["50K+", "Live Jobs"], ["10K+", "Companies"], ["2L+", "Candidates"], ["5K+", "Verified Recruiters"]];

const premium = [
  { tag: "Technology", title: "Technology & Engineering", items: [
    ["AI/Machine Learning Architect", "Designs and scales artificial intelligence systems and infrastructure."],
    ["Cloud Security Architect", "Orchestrates enterprise-grade security protocols for cloud platforms."],
    ["Chief Technology Officer (CTO)", "Leads technology strategy and engineering teams."],
    ["Data Science Director", "Turns big-data analytics into strategic business decisions."],
    ["Principal Software Engineer", "Oversees technical execution and architecture of critical software systems."]] },
  { tag: "Leadership", title: "Executive Leadership & Corporate Strategy", items: [
    ["Chief Executive Officer (CEO)", "Manages company operations, resources and strategic direction."],
    ["Chief Strategy Officer (CSO)", "Develops long-term corporate growth plans and M&A strategy."],
    ["Management Consultant (Partner)", "Advises corporations on efficiency and organizational change."],
    ["Sustainability Director (CSO)", "Leads ESG compliance and sustainability strategy."]] },
  { tag: "Finance", title: "Finance & Investment", items: [
    ["Investment Banking Managing Director", "Leads capital raising, restructuring and mergers and acquisitions."],
    ["Quantitative Trader", "Uses mathematical models to identify trading opportunities."],
    ["Chief Financial Officer (CFO)", "Oversees financial risks, planning and record-keeping."],
    ["Private Equity Principal", "Manages investment portfolios and corporate acquisitions."]] },
  { tag: "Healthcare", title: "Healthcare & Medicine", items: [
    ["Healthcare Leadership", "Explore senior roles across healthcare operations and strategy."],
    ["Medical & Clinical Careers", "Discover opportunities in medicine, clinical leadership and care delivery."]] },
];

const trust: [string, string, string, string, boolean?][] = [
  ["in", "LinkedIn Verified Profile", "Show a LinkedIn verification badge only when the profile or credential is genuinely verified by LinkedIn.", "LinkedIn Verified"],
  ["✓", "Recruiter-Endorsed Profile", "Highlight skills or experience endorsed by a recruiter, with the endorser and endorsement date where available.", "Recruiter Endorsed"],
  ["✓", "Verified Job", "Mark a job as verified only after Jobinfo India completes the relevant checks on the posting and recruiter.", "Jobinfo Verified"],
  ["✓", "Verified Freelance Recruiter", "Identify freelance recruiters whose submitted identity and contact details have been reviewed by Jobinfo India.", "Freelance Verified"],
  ["↗", "Data Safety", "Explain how candidate and recruiter data is handled, protected, and shared with transparency and care.", "Data Safety", true],
];

const campus = [
  ["⌂", "College & University Partners", "Help students discover verified jobs and internships."],
  ["⌂", "Training Institute Partners", "Connect trained candidates with career opportunities."],
  ["⌂", "Placement Cell Network", "Share relevant vacancies and career resources."],
  ["⌂", "Career & Skill Centres", "Promote career guidance and skill development."],
];

async function featuredJobs(): Promise<Job[]> {
  try {
    const r = await fetch(`${API}/api/v1/jobs?featured=true&limit=6`, { cache: "no-store" });
    return r.ok ? (await r.json()).data : [];
  } catch {
    return [];
  }
}

export default async function Home() {
  const jobs = await featuredJobs();
  return (
    <Page>
      <section className="hero">
        <div className="wrap">
          <h1>Find Your Dream Job in India</h1>
          <p className="lead">Search 50,000+ jobs from verified recruiters and top companies</p>
          <form className="search" action="/jobs">
            <input name="q" placeholder="Job title, skill or company" />
            <input name="location" placeholder="Location" />
            <button className="btn">Search Jobs</button>
          </form>
          <div className="chips">
            Popular:{popular.map((p) => <Link key={p} href={`/jobs?q=${encodeURIComponent(p)}`}>{p}</Link>)}
          </div>
        </div>
      </section>

      <section className="stats"><div className="wrap">
        {stats.map(([n, l]) => <div className="stat" key={l}><b>{n}</b><span>{l}</span></div>)}
      </div></section>

      <section className="soft"><div className="wrap section">
        <h2>Browse by Category</h2>
        <div className="grid3">
          {categories.map(([n, c]) => (
            <Link key={n} className="card cat" href={`/jobs?category=${encodeURIComponent(n)}`}><b>{n}</b><span>{c} jobs</span></Link>
          ))}
        </div>
      </div></section>

      <section className="wrap section">
        <h2>Featured Jobs</h2>
        {jobs.length === 0 ? (
          <p className="muted">No featured jobs yet. Run <code>npm run db:seed</code> to load sample jobs.</p>
        ) : (
          <div className="grid3">
            {jobs.map((j) => (
              <div className="card job" key={j.id}>
                <button className="heart" aria-label="Save job">♡</button>
                <h3>{j.title}</h3><div className="co">{j.company}</div>
                <div className="tags">
                  <span className="tag">{j.location}</span>
                  {expLabel(j) && <span className="tag">{expLabel(j)}</span>}
                  {j.verified && <span className="tag ok">Verified</span>}
                </div>
                <div className="jobFoot"><b>{salaryLabel(j)}</b><Link className="btn sm" href="/login">Apply</Link></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="soft"><div className="wrap section">
        <p className="eyebrow">CURATED CAREER OPPORTUNITIES</p>
        <h2>Premium Jobs</h2>
        <p className="lead2">Explore high-impact roles across technology, executive leadership, finance and healthcare.</p>
        <div className="prem">
          {premium.map((g) => (
            <div className="card" key={g.title}>
              <span className="badge">PREMIUM</span>
              <p className="eyebrow">{g.tag.toUpperCase()}</p>
              <h4>{g.title}</h4>
              <dl>{g.items.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
            </div>
          ))}
        </div>
        <p className="fine">Premium placement should be clearly labelled and must not imply guaranteed hiring or verification.</p>
      </div></section>

      <section className="wrap section">
        <p className="eyebrow">TRUST &amp; SAFETY</p>
        <h2>Trust you can see. Safety you can count on.</h2>
        <p className="lead2">Build confidence with clear, transparent trust signals. A badge appears only after the relevant verification or endorsement is completed.</p>
        <div className="grid5">
          {trust.map(([ic, t, d, l, g]) => (
            <div className="card trust" key={t}>
              <div className="icon">{ic}</div><h4>{t}</h4><p>{d}</p><div className={"label" + (g ? " g" : "")}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>
        <p className="fine">Verification badges are displayed only when the applicable checks have actually been completed. A badge is not a guarantee of employment or hiring outcomes.</p>
      </section>

      <section className="wrap" style={{ paddingBottom: 56 }}>
        <h2>Campus &amp; Training Partnerships</h2>
        <div className="grid4 campus">
          {campus.map(([ic, t, d]) => (
            <div className="card" key={t}><div className="icon">{ic}</div><h4 style={{ margin: 0 }}>{t}</h4><p>{d}</p><Link className="more" href="/institutions">Explore Partnership →</Link></div>
          ))}
        </div>
      </section>

      <Pricing />

      <section className="wrap section">
        <div className="cta">
          <div className="card"><h3>I am a Candidate</h3><p>Create your profile, search jobs and apply in minutes.</p><Link className="btn" href="/register/candidate">Register as Candidate</Link></div>
          <div className="card"><h3>I am a Recruiter</h3><p>Post jobs, verify your profile and hire faster.</p><Link className="btn" href="/recruiter/register">Start Hiring</Link></div>
        </div>
      </section>
    </Page>
  );
}
