import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreJobForCandidate } from "./recommendations/job-match";

const job = {
  title: "Senior React Engineer",
  category: "Engineering",
  department: "Product",
  location: "Pune, Maharashtra",
  workplaceType: "ON_SITE",
  experienceMin: 3,
  experienceMax: 6,
  skills: [{ name: "React", kind: "REQUIRED" }, { name: "TypeScript", kind: "REQUIRED" }, { name: "AWS", kind: "PREFERRED" }],
};

test("candidate fit score rewards matching skills, role, location and experience", () => {
  const result = scoreJobForCandidate({
    city: "Pune", state: "Maharashtra", experienceYears: 4,
    preferredJobLocations: ["Pune"], preferredJobRoles: ["React Engineer"],
    skills: [{ name: "React" }, { name: "TypeScript" }, { name: "AWS" }],
  }, job);
  assert.equal(result.fitPercent, 100);
  assert.deepEqual(result.matchedSkills, ["React", "TypeScript"]);
});

test("missing profile signals remain neutral and are explained", () => {
  const result = scoreJobForCandidate({ city: null, state: null, experienceYears: null, preferredJobLocations: [], preferredJobRoles: [], skills: [] }, job);
  assert.equal(result.fitPercent, 50);
  assert.ok(result.reasons.some((reason) => reason.includes("Experience not provided")));
});
