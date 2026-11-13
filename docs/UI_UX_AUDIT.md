# Jobinfo India UI/UX audit

## Scope

Source-level review of the existing Next.js App Router page inventory, shared `Page`/`Header`/`Footer`, global styles, API client, public discovery pages, and the four role dashboards. Existing routes and API-backed business flows remain the source of truth. This is not a live visual test against a deployed environment.

## Findings and planned treatment

| Area and existing routes | Design / UX issue found | Existing parts to retain | Improvement and expected outcome |
| --- | --- | --- | --- |
| Public shell: `/`, `/about`, `/faqs`, `/contact`, `/pricing`, `/for-recruiters`, `/institutions` | Shared CSS had only a few tokens; controls, radius, and spacing varied. Desktop navigation collapsed without a compact hierarchy, and footer links omitted useful destinations. | `Page`, `Header`, `Footer`, `Pricing`, existing routes | Add semantic color/type/spacing tokens, clear focus and hover states, tighter controls, and a compact responsive nav. Maintain the shared shell and route map. |
| Homepage: `/` | Hardcoded counts and category totals looked like live data; “premium jobs,” trust badges and partner content were not backed by current records. Featured job save/apply actions were not connected. | Existing published-job, category, company APIs; `SaveJobButton`, `ApplyButton`, `Pricing` | Use current API records for categories, jobs, and companies; remove unverified placeholder claims; make search, save, view, and apply actions usable. |
| Job search: `/jobs` | Search was a small form followed by a generic three-column card grid; filters, result context, pagination, and list scanning were missing. | Existing `/api/v1/jobs` endpoint and job type | Use a filter rail with compact list results, result count, sort, pagination, and available API filters. |
| Job detail: `/job/[id]` | Listing data was compressed into one card; qualifications, requirements and company information were not separated into readable sections. | Existing public job API, `ApplyButton`, `SaveJobButton` | Group role details and employer context, keep apply/save visible, and render existing job fields without invented data. |
| Company directory: `/companies` | Directory had no search and used repeated cards with little hierarchy. No separate company-profile route exists in the current route inventory. | Existing verified-company API and external-link validation | Add server-backed directory search and compact employer rows. Do not add a duplicate profile route. |
| Candidate: `/candidate/dashboard`, `/candidate/profile`, `/candidate/applications`, `/candidate/saved-jobs` | Dashboard cards and status details rely on long global styles; failed secondary requests could silently look like zero activity. | Existing candidate APIs, profile editor, saved jobs, applications and recommendations | Keep real profile/application data and routes; surface load errors; apply shared typography, surfaces and control states. |
| Recruiter: `/recruiter/dashboard`, `/recruiter/jobs`, `/recruiter/jobs/new`, `/recruiter/applications`, `/recruiter/candidates`, `/recruiter/ats`, `/recruiter/billing` | Overview uses several repeated metric cards; job and applicant management are card-heavy. The posting flow previously exposed too many steps. | Existing ATS, job, candidate and billing routes and APIs | Keep existing workflows; use clearer hierarchy and list/table patterns where practical. The posting form is already condensed to one page with draft save and approval submission. |
| Institution: `/institution/dashboard`, `/institution/billing`, `/institutions` | Student roster and institution operations are presented as long stacked cards; roster search/filter actions need stronger grouping. | Existing institution-scoped APIs, filters, student forms and placement actions | Preserve institution authorization and CRUD; use shared table/list styles and a more scannable workspace. |
| Super Admin: `/admin/dashboard` and existing `/admin/*` pages | Control functions are spread across a dense quick-link grid; moderation and settings deserve clearer hierarchy and consistent tables. | Existing admin API, permissions, audit, approvals, billing and CMS routes | Retain every existing route and permission check; standardize operational tables and status presentation without adding roles. |

## Product patterns considered

The useful patterns are prominent job search, filters that narrow results, and job cards that surface decision details before opening a listing. These are general usability patterns, not copied layouts or branding. References reviewed: [Indeed job-search guidance](https://www.indeed.com/career-advice/finding-a-job/tips-on-how-to-get-better-search-results-on-indeed.com), [Indeed search results and recommendations](https://www.indeed.com/help/job-seekers/articles/about-search-results-and-recommendations), [Naukri search guidance](https://www.naukri.com/blog/onboarding-3-things-to-do-after-creating-naukri-profile/), and [LinkedIn Jobs](https://www.linkedin.com/jobs/).

## Implementation status

The shared style foundation, public header, homepage, job search, job detail, and company directory have been updated. The recruiter overview now focuses on five hiring KPIs; the candidate application list shows its existing status history as a timeline; admin account search uses the submitted query consistently; and the job approval queue is a review table with expandable detail. Remaining candidate, recruiter, institution, and admin pages retain their current workflows and receive the shared style tokens, but still need a page-by-page visual QA/redesign pass before the complete platform transformation can be called finished.

## Design-system tokens introduced

- **Color:** primary `#2563EB`, text/nav `#0F172A`, accent `#F59E0B`, success `#16A34A`, danger `#DC2626`, page background `#F8FAFC`, white surfaces, neutral borders.
- **Typography:** existing Inter font retained; page headings scale responsively, with consistent line height and tighter heading tracking.
- **Spacing:** shared 4/8/12/16/24/32/48/64px spacing variables.
- **Surfaces:** 7px control radius, 10px card radius, subtle border and low-contrast shadow.
- **Interaction:** shared hover, disabled, and visible keyboard-focus states; forms retain labels and use consistent control heights.
- **Responsive rules:** marketplace layouts collapse to one column on narrow screens; tables scroll within their container; mobile navigation remains available.
