import { Router } from "express";
import protectRoute from "../middlewares/auth.middleware.js";
import {
  getConversationMessagesController,
  listConversationsController,
  lookupLawSectionController,
} from "../controllers/aiCounsel.controller";

const router = Router();

router.get("/conversations", protectRoute, listConversationsController);
router.get(
  "/conversations/:conversationId/messages",
  protectRoute,
  getConversationMessagesController
);
router.get("/laws/section", protectRoute, lookupLawSectionController);

export default router;

