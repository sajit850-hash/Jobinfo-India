import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { Pricing } from "@/components/Pricing";
import { SaveJobButton } from "@/components/SaveJobButton";
import { ApplyButton } from "@/components/ApplyButton";
import { API_SERVER as API, Job, expLabel, salaryLabel } from "@/lib/api";

export const dynamic = "force-dynamic";
type Category={name:string;count:number};
type Company={id:string;name:string;industry:string|null;city:string|null;hasOpenJobs?:boolean};
async function fetchJson<T>(path:string):Promise<T|null>{try{const response=await fetch(`${API}${path}`,{cache:"no-store"});return response.ok?await response.json():null;}catch{return null;}}
async function homepageData(){
  const [featured,latest,categories,companies]=await Promise.all([
    fetchJson<{data:Job[]}>("/api/v1/jobs?featured=true&limit=6"),
    fetchJson<{data:Job[]}>("/api/v1/jobs?limit=6"),
    fetchJson<{data:Category[]}>("/api/v1/jobs/categories"),
    fetchJson<{data:Company[]}>("/api/v1/companies"),
  ]);
  const priority=featured?.data||[];
  const jobs=priority.length?priority:(latest?.data||[]);
  return {jobs,categories:categories?.data||[],companies:companies?.data||[]};
}

export default async function Home(){
  const {jobs,categories,companies}=await homepageData();
  return <Page>
    <main>
      <section className="homeHero"><div className="wrap homeHeroInner">
        <p className="eyebrow">JOBINFO INDIA · CAREERS THAT MOVE YOU</p>
        <h1>Find work that fits<br/>your next chapter.</h1>
        <p className="lead">Search current opportunities from employers on Jobinfo India.</p>
        <form className="homeSearch" action="/jobs" role="search">
          <label><span>Job title or skill</span><input name="q" placeholder="e.g. Accountant, React, Sales"/></label>
          <label><span>Location</span><input name="location" placeholder="City, state or remote"/></label>
          <label><span>Experience</span><select name="experienceMin" defaultValue=""><option value="">Any experience</option><option value="0">Fresher</option><option value="1">1+ years</option><option value="3">3+ years</option><option value="5">5+ years</option></select></label>
          <button className="btn" type="submit">Search jobs</button>
        </form>
        <div className="homePopular"><span>Popular searches</span>{["Software Developer","Sales Executive","Accountant","HR Recruiter"].map(term=><Link key={term} href={`/jobs?q=${encodeURIComponent(term)}`}>{term}</Link>)}</div>
      </div></section>

      <section className="wrap section homeSection"><div className="sectionTitle"><div><p className="eyebrow">EXPLORE</p><h2>Browse by category</h2></div><Link className="textLink" href="/jobs">All jobs →</Link></div>
        {categories.length?<div className="categoryList">{categories.slice(0,12).map(category=><Link className="categoryLink" href={`/jobs?category=${encodeURIComponent(category.name)}`} key={category.name}><span>{category.name}</span><small>{category.count} {category.count===1?"opening":"openings"}</small></Link>)}</div>:<p className="muted">Categories will appear as employers publish jobs.</p>}
      </section>

      <section className="homeJobsBand"><div className="wrap section homeSection"><div className="sectionTitle"><div><p className="eyebrow">CURRENT OPENINGS</p><h2>{jobs.some(job=>job.featured)?"Featured jobs":"Recently posted jobs"}</h2><p className="muted">Explore live listings and review the details before applying.</p></div><Link className="btn outline" href="/jobs">Browse all jobs</Link></div>
        {jobs.length?<div className="homeJobList">{jobs.map(job=><article className="homeJob" key={job.id}><div className="companyMark" aria-hidden="true">{job.company.trim().slice(0,1).toUpperCase()}</div><div className="homeJobMain"><Link className="homeJobTitle" href={`/job/${job.id}`}>{job.title}</Link><div className="homeJobCompany">{job.company}{job.verified&&<span className="verifiedMark">Verified employer</span>}</div><div className="homeJobMeta"><span>{job.location}</span>{expLabel(job)&&<span>{expLabel(job)}</span>}{job.employmentType&&<span>{job.employmentType.replaceAll("_"," ").toLowerCase()}</span>}{job.workplaceType&&<span>{job.workplaceType.replaceAll("_"," ").toLowerCase()}</span>}{salaryLabel(job)!=="Not disclosed"&&<span>{salaryLabel(job)}</span>}{job.createdAt&&<span>Posted {new Date(job.createdAt).toLocaleDateString("en-IN")}</span>}</div>{job.skills&&job.skills.length>0&&<div className="homeSkillList">{job.skills.slice(0,4).map(skill=><span key={`${job.id}-${skill.name}`}>{skill.name}</span>)}</div>}</div><div className="homeJobActions"><Link className="btn outline sm" href={`/job/${job.id}`}>View job</Link><SaveJobButton jobId={job.id}/><ApplyButton jobId={job.id}/></div></article>)}</div>:<div className="emptyState"><h3>No published jobs yet</h3><p className="muted">New openings will appear here once they are approved and published.</p><Link className="btn outline" href="/jobs">Search jobs</Link></div>}
      </div></section>

      <section className="wrap section homeSection"><div className="sectionTitle"><div><p className="eyebrow">EMPLOYERS</p><h2>Companies hiring on Jobinfo India</h2><p className="muted">Verified companies with published jobs.</p></div><Link className="textLink" href="/companies">Company directory →</Link></div>
        {companies.length?<div className="companyList">{companies.slice(0,6).map(company=><article className="companyRow" key={company.id}><div className="companyMark" aria-hidden="true">{company.name.trim().slice(0,1).toUpperCase()}</div><div><b>{company.name}</b><small>{[company.industry,company.city].filter(Boolean).join(" · ")||"Company profile"}</small></div><Link className="textLink" href={`/jobs?q=${encodeURIComponent(company.name)}`}>View jobs →</Link></article>)}</div>:<p className="muted">Verified employers will appear here when they have published openings.</p>}
      </section>

      <section className="homeAudience"><div className="wrap homeAudienceGrid"><article><p className="eyebrow">FOR JOB SEEKERS</p><h2>Make your next move count.</h2><p>Create a profile, save relevant openings and keep track of your applications.</p><Link className="btn" href="/register/candidate">Create a candidate profile</Link></article><article><p className="eyebrow">FOR EMPLOYERS</p><h2>Build your hiring pipeline.</h2><p>Post a job, review applicants and manage hiring activity in one place.</p><div className="homeAudienceActions"><Link className="btn" href="/recruiter/register">Get started as a recruiter</Link><Link className="btn outline" href="/for-recruiters">Recruiter information</Link></div></article><article><p className="eyebrow">FOR INSTITUTIONS</p><h2>Support student outcomes.</h2><p>Organize student profiles, departments and placement activity.</p><Link className="btn outline" href="/institutions">Explore institution features</Link></article></div></section>

      <section className="wrap section"><Pricing/></section>
    </main>
  </Page>;
}
