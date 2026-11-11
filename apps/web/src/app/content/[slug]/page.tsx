import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/components/SiteChrome";

const apiBase = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
async function getPage(slug: string) {
  try { const response = await fetch(`${apiBase}/api/v1/cms/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } }); if (!response.ok) return null; return (await response.json()).page; } catch { return null; }
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const page = await getPage(slug);
  return { title: page?.metaTitle || page?.title || "Page", description: page?.metaDescription || undefined };
}
export default async function CmsContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const page = await getPage(slug); if (!page) notFound();
  return <Page><main className="wrap section cmsPublicPage"><p className="eyebrow">JOBINFO INDIA</p><h1>{page.title}</h1><div className="cmsPublicBody">{page.body}</div></main></Page>;
}
