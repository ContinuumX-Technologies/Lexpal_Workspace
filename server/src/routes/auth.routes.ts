import express from "express";

import { UserSignup, UserLogin } from "../controllers/user_auth.controller.js";

import { GoogleAuth } from "../controllers/google_auth.controller.js";

const authRouter = express.Router();

authRouter.post("/signup", UserSignup);

authRouter.post("/login", UserLogin);

authRouter.post("/google", GoogleAuth);

export default authRouter;