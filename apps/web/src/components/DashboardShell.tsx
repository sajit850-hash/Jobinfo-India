"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type DashboardRole = "candidate" | "recruiter" | "institution" | "admin";
const navigation: Record<DashboardRole, [string, string][]> = {
  candidate: [["Dashboard", "/candidate/dashboard"], ["My Profile", "/candidate/profile"], ["Find Jobs", "/jobs"], ["Saved Jobs", "/candidate/saved-jobs"], ["Applications", "/candidate/applications"], ["Security & Privacy", "/account/security"]],
  recruiter: [["Dashboard", "/recruiter/dashboard"], ["Recruiter Profile", "/recruiter/dashboard#company-profile"], ["All Jobs", "/recruiter/jobs?filter=all"], ["Active Jobs", "/recruiter/jobs?filter=active"], ["Pending Jobs", "/recruiter/jobs?filter=pending"], ["Closed Jobs", "/recruiter/jobs?filter=closed"], ["Post a Job", "/recruiter/jobs/new"], ["Applications", "/recruiter/applications"], ["ATS Submissions", "/recruiter/ats"], ["Search Candidates", "/recruiter/candidates"], ["Plans & Usage", "/recruiter/billing"], ["Settings", "/account/security"]],
  institution: [["Dashboard", "/institution/dashboard"], ["College Profile", "/institution/dashboard#college-profile"], ["Departments", "/institution/dashboard#departments"], ["Student Database", "/institution/dashboard#student-form"], ["Placement Tracking", "/institution/dashboard#roster"], ["Billing & Plans", "/institution/billing"], ["Security & Privacy", "/account/security"]],
  admin: [["Dashboard", "/admin/dashboard"], ["Users & Recruiters", "/admin/users"], ["Registration Approvals", "/admin/registrations"], ["Job Approvals", "/admin/jobs"], ["Institutions", "/admin/institutions"], ["Plans & Pricing", "/admin/plans"], ["Billing & Cases", "/admin/billing"], ["Reports & Analytics", "/admin/reports"], ["CMS & SEO", "/admin/cms"], ["Roles & Access", "/admin/access-matrix"], ["Security Audit", "/admin/audit"], ["Integrations", "/admin/integrations"]],
};

export function DashboardShell({ role, children }: { role: DashboardRole; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="dashboardShell">
    <aside className="dashboardSidebar" aria-label={`${role} dashboard navigation`}>
      <p className="dashboardSidebarTitle">{role === "admin" ? "ADMINISTRATION" : `${role.toUpperCase()} WORKSPACE`}</p>
      <nav><Suspense fallback={null}><DashboardLinks role={role} pathname={pathname} /></Suspense></nav>
      <Link className="dashboardLogout" href="/">Back to website</Link>
    </aside>
    <div className="dashboardMain">{children}</div>
  </div>;
}

function DashboardLinks({ role, pathname }: { role: DashboardRole; pathname: string }) {
  const searchParams = useSearchParams();
  return <>{navigation[role].map(([label, href]) => {
        const target = href.split(/[?#]/)[0];
        const filter = new URLSearchParams(href.split("?")[1] || "").get("filter");
        const active = pathname === target && (filter ? searchParams.get("filter") === filter : !href.includes("#") && !href.includes("?"));
        return <Link key={label} className={`dashboardNavLink${active ? " active" : ""}`} href={href} aria-current={active ? "page" : undefined}><span aria-hidden="true">&rsaquo;</span>{label}</Link>;
      })}</>;
}
