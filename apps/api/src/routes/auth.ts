import { Router } from "express";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { UserStore } from "../store/types.js";

const CredentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export function createAuthRouter(userStore: UserStore): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parsed = CredentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }
    const { email, password } = parsed.data;

    const existing = await userStore.findByEmail(email);
    if (existing) {
      res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "An account with that email already exists." } });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await userStore.create(email, passwordHash);
    req.session.userId = user.id;
    res.status(201).json({ id: user.id, email: user.email });
  });

  router.post("/login", async (req, res) => {
    const parsed = CredentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }
    const { email, password } = parsed.data;

    const user = await userStore.findByEmail(email);
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) {
      res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } });
      return;
    }

    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email });
  });

  router.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.status(204).end();
    });
  });

  router.get("/me", requireAuth, async (req, res) => {
    const user = await userStore.findById(req.session.userId!);
    if (!user) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } });
      return;
    }
    res.json({ id: user.id, email: user.email });
  });

  return router;
}
