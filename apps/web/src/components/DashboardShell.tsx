"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type DashboardRole = "candidate" | "recruiter" | "institution" | "admin";
const navigation: Record<DashboardRole, [string, string][]> = {
  candidate: [["Dashboard", "/candidate/dashboard"], ["My Profile", "/candidate/profile"], ["Find Jobs", "/jobs"], ["Saved Jobs", "/candidate/saved-jobs"], ["Applications", "/candidate/applications"], ["Security & Privacy", "/account/security"]],
  recruiter: [["Dashboard", "/recruiter/dashboard"], ["Company Profile", "/recruiter/dashboard#company-profile"], ["Post a Job", "/recruiter/jobs/new"], ["Manage Jobs", "/recruiter/jobs"], ["Applications", "/recruiter/applications"], ["Search Candidates", "/recruiter/candidates"], ["ATS Matching", "/recruiter/ats"], ["Billing & Plans", "/recruiter/billing"], ["Security & Privacy", "/account/security"]],
  institution: [["Dashboard", "/institution/dashboard"], ["College Profile", "/institution/dashboard#college-profile"], ["Departments", "/institution/dashboard#departments"], ["Student Database", "/institution/dashboard#student-form"], ["Placement Tracking", "/institution/dashboard#roster"], ["Billing & Plans", "/institution/billing"], ["Security & Privacy", "/account/security"]],
  admin: [["Dashboard", "/admin/dashboard"], ["Users & Recruiters", "/admin/users"], ["Registration Approvals", "/admin/registrations"], ["Job Approvals", "/admin/jobs"], ["Institutions", "/admin/institutions"], ["Plans & Pricing", "/admin/plans"], ["Billing & Cases", "/admin/billing"], ["Reports & Analytics", "/admin/reports"], ["CMS & SEO", "/admin/cms"], ["Roles & Access", "/admin/access-matrix"], ["Security Audit", "/admin/audit"], ["Integrations", "/admin/integrations"]],
};

export function DashboardShell({ role, children }: { role: DashboardRole; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="dashboardShell">
    <aside className="dashboardSidebar" aria-label={`${role} dashboard navigation`}>
      <p className="dashboardSidebarTitle">{role === "admin" ? "ADMINISTRATION" : `${role.toUpperCase()} WORKSPACE`}</p>
      <nav>{navigation[role].map(([label, href]) => {
        const target = href.split("#")[0];
        const active = !href.includes("#") && pathname === target;
        return <Link key={label} className={`dashboardNavLink${active ? " active" : ""}`} href={href} aria-current={active ? "page" : undefined}><span aria-hidden="true">&rsaquo;</span>{label}</Link>;
      })}</nav>
      <Link className="dashboardLogout" href="/">Back to website</Link>
    </aside>
    <div className="dashboardMain">{children}</div>
  </div>;
}
