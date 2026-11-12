CREATE TYPE "RegistrationStatus" AS ENUM (
    'ACCOUNT_CREATED',
    'MOBILE_VERIFIED',
    'EMAIL_VERIFIED',
    'VERIFICATION_COMPLETED',
    'PROFILE_INCOMPLETE',
    'PROFILE_COMPLETED',
    'REGISTRATION_COMPLETED'
);

ALTER TABLE "User"
    ADD COLUMN "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'ACCOUNT_CREATED',
    ADD COLUMN "registrationDraft" JSONB;

ALTER TABLE "Candidate"
    ADD COLUMN "dateOfBirth" TIMESTAMP(3),
    ADD COLUMN "gender" TEXT,
    ADD COLUMN "currentAddress" TEXT,
    ADD COLUMN "postalCode" TEXT,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "highestQualification" TEXT,
    ADD COLUMN "course" TEXT,
    ADD COLUMN "grade" TEXT,
    ADD COLUMN "expectedSalary" INTEGER,
    ADD COLUMN "preferredJobLocations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "preferredJobRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "employmentType" TEXT,
    ADD COLUMN "workMode" TEXT,
    ADD COLUMN "noticePeriod" TEXT,
    ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "linkedinUrl" TEXT,
    ADD COLUMN "portfolioUrl" TEXT;

ALTER TABLE "Education"
    ADD COLUMN "grade" TEXT;

ALTER TABLE "Certification"
    ADD COLUMN "issueDate" TIMESTAMP(3),
    ADD COLUMN "expiryDate" TIMESTAMP(3);

ALTER TABLE "WorkExperience"
    ADD COLUMN "employmentType" TEXT;

ALTER TABLE "Employer"
    ADD COLUMN "recruiterDesignation" TEXT,
    ADD COLUMN "recruiterProfilePhotoKey" TEXT,
    ADD COLUMN "recruiterDepartment" TEXT,
    ADD COLUMN "recruiterLinkedinUrl" TEXT,
    ADD COLUMN "companySize" TEXT,
    ADD COLUMN "description" TEXT,
    ADD COLUMN "registeredAddress" TEXT,
    ADD COLUMN "state" TEXT,
    ADD COLUMN "postalCode" TEXT,
    ADD COLUMN "country" TEXT NOT NULL DEFAULT 'India',
    ADD COLUMN "gstin" TEXT,
    ADD COLUMN "companyLinkedinUrl" TEXT,
    ADD COLUMN "companyLogoKey" TEXT,
    ADD COLUMN "hiringDepartments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "hiringLocations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "hiringVolume" INTEGER,
    ADD COLUMN "positionTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "recruitmentRequirements" TEXT,
    ADD COLUMN "professionalExperienceYears" INTEGER,
    ADD COLUMN "specialization" TEXT,
    ADD COLUMN "preferredHiringCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "corporateContactDetails" JSONB,
    ADD COLUMN "verificationDocumentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "teamInformation" JSONB;

ALTER TABLE "Institution"
    ADD COLUMN "institutionType" TEXT,
    ADD COLUMN "category" TEXT,
    ADD COLUMN "establishedYear" INTEGER,
    ADD COLUMN "affiliation" TEXT,
    ADD COLUMN "accreditation" TEXT,
    ADD COLUMN "registrationNumber" TEXT,
    ADD COLUMN "description" TEXT,
    ADD COLUMN "contactDesignation" TEXT,
    ADD COLUMN "address" TEXT,
    ADD COLUMN "postalCode" TEXT,
    ADD COLUMN "country" TEXT NOT NULL DEFAULT 'India',
    ADD COLUMN "logoKey" TEXT,
    ADD COLUMN "studentStrength" INTEGER,
    ADD COLUMN "passingYears" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "placementOfficer" JSONB,
    ADD COLUMN "registrationDocumentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "accreditationDocumentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "affiliationDocumentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "InstitutionCourse" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstitutionCourse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstitutionCourse_institutionId_name_idx"
    ON "InstitutionCourse"("institutionId", "name");

ALTER TABLE "InstitutionCourse"
    ADD CONSTRAINT "InstitutionCourse_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
