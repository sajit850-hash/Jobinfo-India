import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Jobinfo India | Jobs, Companies and Careers", template: "%s | Jobinfo India" },
  description: "Search jobs from verified recruiters and top companies in India.",
  applicationName: "Jobinfo India",
  openGraph: { type: "website", siteName: "Jobinfo India", title: "Jobinfo India | Jobs, Companies and Careers", description: "Search jobs from verified recruiters and top companies in India." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
