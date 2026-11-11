export type Plan = { name: string; price: number; featured?: boolean; features: string[] };

export const freelancePlans: Plan[] = [
  { name: "Free", price: 0, features: ["1 active job post", "Basic recruiter profile", "View 10 applicants per month", "Jobinfo watermark on posts"] },
  { name: "₹100 Plan", price: 100, featured: true, features: ["5 active job posts", "100 applicant views per month", "Verified recruiter badge", "5 Profile Recruiter Recommendation", "Email alerts"] },
  { name: "₹500 Plan", price: 500, features: ["20 active job posts", "500 applicant views per month", "2 featured posts/month", "5 Profile Recruiter Recommendation"] },
];
export const corporatePlans: Plan[] = [
  { name: "Free", price: 0, features: ["1 active job post", "Basic company profile", "View 10 applicants per month", "Standard job listing"] },
  { name: "₹499 Plan", price: 499, featured: true, features: ["5 active job posts", "100 applicant views per month", "Company profile page", "5 Profile Recruiter Recommendation", "Email alerts"] },
  { name: "₹999 Plan", price: 999, features: ["15 active job posts", "500 applicant views per month", "Enhanced company profile", "Featured job post benefits", "5 Profile Recruiter Recommendation"] },
];
