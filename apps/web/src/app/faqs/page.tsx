import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: "Answers about finding jobs, applying, recruiter accounts and institution listings on Jobinfo India.",
};

const faqs = [
  ["How do I find a job?", "Use Find Jobs to search published openings by job title, skills, company or location. Open a listing to review the role and application details."],
  ["Do I need an account to apply?", "Yes. Create a candidate account and sign in to submit and track applications."],
  ["How can a recruiter post a job?", "Create a recruiter account, complete your profile and submit a job for review. Approved listings are published for candidates."],
  ["Why can't I find a company or institution?", "Company listings show verified employers with published openings. The institution directory shows verified institutions, so new submissions may not appear until reviewed."],
  ["Does a verification badge guarantee a job or employer outcome?", "No. Verification indicates that the relevant platform checks were completed; it does not guarantee employment, hiring outcomes or the terms of a job."],
  ["Where can I ask another question?", "Use the Contact page to choose the candidate, recruiter or institution account path that fits your enquiry."],
];

export default function FAQsPage() {
  return <Page><main className="wrap section prosePage">
    <p className="eyebrow">HELP CENTRE</p><h1>Frequently asked questions</h1>
    <div className="faqList">{faqs.map(([question, answer]) => <details className="faqItem" key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
    <p className="note">Still need help? <Link className="textLink" href="/contact">Contact us</Link>.</p>
  </main></Page>;
}
