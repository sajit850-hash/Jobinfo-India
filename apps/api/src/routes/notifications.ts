import { Router } from "express";
import { prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth());
notificationsRouter.get("/", async (req,res) => {
  const data=await prisma.notification.findMany({where:{userId:userOf(req).id},orderBy:{createdAt:"desc"},take:100});
  res.json({data});
});
notificationsRouter.patch("/:id/read", async (req,res) => {
  const result=await prisma.notification.updateMany({where:{id:String(req.params.id),userId:userOf(req).id},data:{readAt:new Date()}});
  if(!result.count)return res.status(404).json({error:"Notification not found"});
  res.json({ok:true});
});
