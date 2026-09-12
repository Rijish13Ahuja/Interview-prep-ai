import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import session, { type SessionOptions } from "express-session";
import type { GenerationStep, PipelineDeps } from "@trao/core";
import { createAuthRouter } from "./routes/auth.js";
import { createKitsRouter } from "./routes/kits.js";
import { buildPipelineDeps as defaultBuildPipelineDeps } from "./generation/deps.js";
import type { KitStore, UserStore } from "./store/types.js";

export interface AppDeps {
  userStore: UserStore;
  kitStore: KitStore;
  sessionSecret: string;
  sessionStore?: SessionOptions["store"];
  corsOrigin?: string | string[];
  /** Injectable for tests — defaults to the real Gemini-backed pipeline deps. */
  buildPipelineDeps?: (onStep?: (step: GenerationStep) => void) => PipelineDeps;
}

export function createApp(deps: AppDeps) {
  const app = express();
  // Free-tier hosts (Render/Railway/etc.) terminate TLS at a reverse proxy — without this,
  // Express sees plain http and a `secure` cookie would never be set.
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "2mb" }));
  app.use(cors({ origin: deps.corsOrigin ?? true, credentials: true }));
  app.use(
    session({
      secret: deps.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: deps.sessionStore,
      cookie: {
        httpOnly: true,
        // Deployed frontend/API are typically on different origins (cross-site), which requires
        // SameSite=None (paired with Secure, mandatory for None). Local dev keeps Lax since
        // localhost:3000/localhost:4000 are same-site and Lax works fine over plain http.
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,
        secure: process.env.NODE_ENV === "production",
      },
    })
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", createAuthRouter(deps.userStore));
  app.use("/api/kits", createKitsRouter(deps.kitStore, deps.buildPipelineDeps ?? defaultBuildPipelineDeps));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  // Structured errors instead of Express's default HTML error page.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
  });

  return app;
}
