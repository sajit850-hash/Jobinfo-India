import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { getResumeStorage } from "../integrations/registry";

export const profileFilesRouter = Router();
profileFilesRouter.use(requireAuth());

const uploadSchema = z.object({
  category: z.enum(["recruiterPhoto", "companyLogo", "companyVerification", "institutionLogo", "institutionRegistration", "institutionAccreditation", "institutionAffiliation"]),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().max(100),
  data: z.string().min(1).max(14_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

function decodeFile(fileName: string, contentType: string, encoded: string, imageOnly: boolean) {
  const extensions: Record<string, string[]> = imageOnly
    ? { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"] }
    : {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
    };
  if (!extensions[contentType]?.some((extension) => fileName.toLowerCase().endsWith(extension))) throw new Error("Unsupported file type");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) throw new Error("Invalid file data");
  const valid = contentType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : contentType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
      : contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : contentType === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
          : false;
  if (!valid) throw new Error("File contents do not match the selected type");
  return bytes;
}

profileFilesRouter.post("/", async (req, res) => {
  const p = uploadSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const user = userOf(req);
  const recruiterCategories = ["recruiterPhoto", "companyLogo", "companyVerification"];
  const institutionCategories = ["institutionLogo", "institutionRegistration", "institutionAccreditation", "institutionAffiliation"];
  if (user.role === "RECRUITER" && !recruiterCategories.includes(p.data.category)) return res.status(403).json({ error: "This file category is not available for recruiter accounts" });
  if (user.role === "INSTITUTION" && !institutionCategories.includes(p.data.category)) return res.status(403).json({ error: "This file category is not available for institution accounts" });
  if (user.role === "CANDIDATE") return res.status(403).json({ error: "Use the candidate resume and photo upload endpoints" });

  const imageOnly = ["recruiterPhoto", "companyLogo", "institutionLogo"].includes(p.data.category);
  let bytes: Buffer;
  try {
    bytes = decodeFile(p.data.fileName, p.data.contentType, p.data.data, imageOnly);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid file" });
  }
  const maxBytes = imageOnly ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
  if (bytes.length > maxBytes) return res.status(400).json({ error: `File exceeds the ${imageOnly ? "2 MB" : "10 MB"} limit` });
  try {
    const saved = await getResumeStorage().save({
      ownerId: user.id,
      fileName: p.data.fileName.replace(/[\\/\r\n]/g, "_"),
      contentType: p.data.contentType,
      bytes,
    });
    const category = p.data.category;
    if (user.role === "RECRUITER") {
      const employer = await prisma.employer.findUniqueOrThrow({ where: { userId: user.id } });
      if (category === "recruiterPhoto" || category === "companyLogo") {
        await prisma.employer.update({
          where: { id: employer.id },
          data: category === "recruiterPhoto" ? { recruiterProfilePhotoKey: saved.key } : { companyLogoKey: saved.key },
        });
      } else {
        await prisma.employer.update({ where: { id: employer.id }, data: { verificationDocumentKeys: { push: saved.key } } });
      }
    } else {
      const institution = await prisma.institution.findUniqueOrThrow({ where: { userId: user.id } });
      const field = category === "institutionLogo" ? "logoKey"
        : category === "institutionRegistration" ? "registrationDocumentKeys"
          : category === "institutionAccreditation" ? "accreditationDocumentKeys"
            : "affiliationDocumentKeys";
      if (field === "logoKey") await prisma.institution.update({ where: { id: institution.id }, data: { logoKey: saved.key } });
      else if (field === "registrationDocumentKeys") await prisma.institution.update({ where: { id: institution.id }, data: { registrationDocumentKeys: { push: saved.key } } });
      else if (field === "accreditationDocumentKeys") await prisma.institution.update({ where: { id: institution.id }, data: { accreditationDocumentKeys: { push: saved.key } } });
      else await prisma.institution.update({ where: { id: institution.id }, data: { affiliationDocumentKeys: { push: saved.key } } });
    }
    res.status(201).json({ ok: true, fileName: p.data.fileName, size: saved.size });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not securely store the file" });
  }
});

profileFilesRouter.get("/download", async (req, res) => {
  const user = userOf(req);
  const key = String(req.query.key ?? "");
  if (!key.startsWith(`users/${user.id}/`)) return res.status(404).json({ error: "File not found" });
  const [employer, institution, candidate] = await Promise.all([
    prisma.employer.findUnique({ where: { userId: user.id } }),
    prisma.institution.findUnique({ where: { userId: user.id } }),
    prisma.candidate.findUnique({ where: { userId: user.id } }),
  ]);
  const owned = employer?.recruiterProfilePhotoKey === key || employer?.companyLogoKey === key || employer?.verificationDocumentKeys.includes(key)
    || institution?.logoKey === key || institution?.registrationDocumentKeys.includes(key) || institution?.accreditationDocumentKeys.includes(key) || institution?.affiliationDocumentKeys.includes(key)
    || candidate?.resumeUrl === key || candidate?.profilePhotoKey === key;
  if (!owned) return res.status(404).json({ error: "File not found" });
  try {
    const file = await getResumeStorage().read(key);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.bytes.length);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/[\r\n"\\]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.bytes);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});
