type CandidateForMatch = {
  city: string | null;
  state: string | null;
  experienceYears: number | null;
  preferredJobLocations: string[];
  preferredJobRoles: string[];
  skills: { name: string }[];
};

type JobForMatch = {
  title: string;
  category: string | null;
  department: string | null;
  location: string;
  workplaceType: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  skills: { name: string; kind: string }[];
};

const normalize = (value: string) => value.trim().toLocaleLowerCase("en-IN");
const overlaps = (left: string, right: string) => {
  const a = normalize(left);
  const b = normalize(right);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
};

/** Transparent profile-to-job fit signals for candidate discovery; not a hiring decision. */
export function scoreJobForCandidate(candidate: CandidateForMatch, job: JobForMatch) {
  const requiredSkills = job.skills.filter((skill) => skill.kind === "REQUIRED").map((skill) => skill.name);
  const preferredSkills = job.skills.filter((skill) => skill.kind !== "REQUIRED").map((skill) => skill.name);
  const candidateSkills = candidate.skills.map((skill) => skill.name);
  const matchedSkills = requiredSkills.filter((required) => candidateSkills.some((skill) => overlaps(skill, required)));
  const requiredScore = requiredSkills.length ? (matchedSkills.length / requiredSkills.length) * 100 : 50;
  const matchedPreferred = preferredSkills.filter((preferred) => candidateSkills.some((skill) => overlaps(skill, preferred)));
  const skillScore = candidateSkills.length === 0 ? 50 : preferredSkills.length
    ? Math.round((requiredScore * 0.8) + ((matchedPreferred.length / preferredSkills.length) * 20))
    : Math.round(requiredScore);

  const roleTerms = [job.title, job.category || "", job.department || ""].filter(Boolean);
  const roleScore = candidate.preferredJobRoles.length
    ? (candidate.preferredJobRoles.some((role) => roleTerms.some((term) => overlaps(role, term))) ? 100 : 0)
    : 50;

  const isRemote = job.workplaceType === "REMOTE" || normalize(job.location).includes("remote");
  const candidateLocations = candidate.preferredJobLocations.length
    ? candidate.preferredJobLocations
    : [candidate.city || "", candidate.state || ""].filter(Boolean);
  const locationScore = isRemote ? 100 : candidateLocations.length
    ? (candidateLocations.some((location) => overlaps(location, job.location)) ? 100 : 0)
    : 50;

  let experienceScore = 50;
  if (candidate.experienceYears != null && (job.experienceMin != null || job.experienceMax != null)) {
    const years = candidate.experienceYears;
    if ((job.experienceMin == null || years >= job.experienceMin) && (job.experienceMax == null || years <= job.experienceMax)) experienceScore = 100;
    else if (job.experienceMin != null && years < job.experienceMin) experienceScore = Math.max(0, 100 - (job.experienceMin - years) * 20);
    else if (job.experienceMax != null && years > job.experienceMax) experienceScore = Math.max(0, 100 - (years - job.experienceMax) * 10);
  } else if (candidate.experienceYears != null && job.experienceMin == null && job.experienceMax == null) {
    experienceScore = 100;
  }

  const fitPercent = Math.round(skillScore * 0.55 + roleScore * 0.2 + locationScore * 0.15 + experienceScore * 0.1);
  const reasons = [
    !candidateSkills.length ? "Add profile skills for a skill comparison" : requiredSkills.length ? `${matchedSkills.length} of ${requiredSkills.length} required skills match` : "Job has no required skills listed",
    candidate.preferredJobRoles.length ? (roleScore ? "Preferred role matches" : "Preferred role differs") : "No preferred role set",
    isRemote ? "Remote work is available" : locationScore ? "Location matches your preferences" : "Location differs from your preferences",
    candidate.experienceYears == null ? "Experience not provided" : `${candidate.experienceYears} years of experience`,
  ];
  return { fitPercent, skillScore, matchedSkills, reasons };
}
