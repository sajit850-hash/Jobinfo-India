import { Router } from "express";
import { prisma } from "@jobinfo/database";

export const companiesRouter = Router();

companiesRouter.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const liveListing={status:"PUBLISHED" as const,visibility:"PUBLIC" as const,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]};
  const companies = await prisma.employer.findMany({
    where: {
      verified: true,
      jobs: { some: liveListing },
      ...(q ? { OR: [
        { name: { contains: q, mode: "insensitive" } },
        { industry: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ] } : {}),
    },
    select: {
      id: true, name: true, website: true, industry: true, city: true,
      jobs: { where: liveListing, select: { id: true }, take: 1 },
    },
    orderBy: { name: "asc" },
    take: 100,
  });
  res.json({ data: companies.map(({ jobs, ...company }) => ({ ...company, hasOpenJobs: jobs.length > 0 })) });
});
