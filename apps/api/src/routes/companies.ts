import { Router } from "express";
import { prisma } from "@jobinfo/database";

export const companiesRouter = Router();

companiesRouter.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const companies = await prisma.employer.findMany({
    where: {
      verified: true,
      jobs: { some: { status: "PUBLISHED" } },
      ...(q ? { OR: [
        { name: { contains: q, mode: "insensitive" } },
        { industry: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ] } : {}),
    },
    select: {
      id: true, name: true, website: true, industry: true, city: true,
      jobs: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 },
    },
    orderBy: { name: "asc" },
    take: 100,
  });
  res.json({ data: companies.map(({ jobs, ...company }) => ({ ...company, hasOpenJobs: jobs.length > 0 })) });
});
