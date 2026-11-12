import { z } from "zod";

export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .refine((value) => /^(\+91)?[6-9]\d{9}$/.test(value), "Enter a valid Indian mobile number")
  .transform((value) => (value.startsWith("+91") ? value : "+91" + value));
