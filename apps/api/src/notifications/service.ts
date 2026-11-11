import { prisma } from "@jobinfo/database";
import { getEmailProvider } from "../integrations/registry";

export async function notifyUser(input: { userId: string; title: string; body: string; emailSubject?: string }) {
  const [notification, user] = await Promise.all([
    prisma.notification.create({ data: { userId: input.userId, title: input.title, body: input.body } }),
    input.emailSubject ? prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } }) : Promise.resolve(null),
  ]);
  if (user?.email && input.emailSubject) {
    try { await getEmailProvider().send({ to: user.email, subject: input.emailSubject, text: input.body }); }
    catch (error) { console.error("Email notification delivery failed", error instanceof Error ? error.message : "unknown error"); }
  }
  return notification;
}
