import type { Metadata } from "next";
import InstitutionDirectory from "./InstitutionDirectory";

export const metadata: Metadata = {
  title: "College and institution directory",
  description: "Explore verified colleges, universities and training partners listed on Jobinfo India.",
};

export default function InstitutionsPage() {
  return <InstitutionDirectory />;
}
