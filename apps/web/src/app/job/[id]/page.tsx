import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { API_SERVER as API } from "@/lib/api";
import { ApplyButton } from "@/components/ApplyButton";
import { SaveJobButton } from "@/components/SaveJobButton";
export const dynamic="force-dynamic";
export default async function JobDetail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;let job:any=null;try{const r=await fetch(`${API}/api/v1/jobs/${id}`,{cache:"no-store"});if(r.ok)job=(await r.json()).job;}catch{}
 return <Page><main className="wrap section">{!job?<div className="card"><h1>Job not found</h1><Link href="/jobs">Browse jobs</Link></div>:<div className="card"><p className="eyebrow">{job.category||"Career opportunity"}</p><h1>{job.title}</h1><h3>{job.employer.name}</h3><p>{job.location} · {job.employmentType||"Employment type not specified"}</p><p>{job.description}</p><p>{job.salaryMin!=null?`${job.salaryMin}–${job.salaryMax??job.salaryMin} LPA`:"Salary not disclosed"}</p><div className="row2"><ApplyButton jobId={id}/><SaveJobButton jobId={id}/></div></div>}</main></Page>;
}
