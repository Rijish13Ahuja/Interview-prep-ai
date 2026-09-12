import type { Kit } from "@trao/core";

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface UserStore {
  create(email: string, passwordHash: string): Promise<StoredUser>;
  findByEmail(email: string): Promise<StoredUser | null>;
  findById(id: string): Promise<StoredUser | null>;
}

export type KitRunStatus = "pending" | "generating" | "ok" | "failed";

export interface KitError {
  code: string;
  message: string;
}

export interface PracticeState {
  /** card id -> last confidence rating (1 = least confident, 3 = most confident) */
  confidenceByCardId: Record<string, number>;
  coveredCardIds: string[];
}

export interface StoredKit {
  id: string;
  ownerId: string;
  jd: string;
  companyUrl: string;
  days: number;
  status: KitRunStatus;
  step: string | null;
  error: KitError | null;
  kit: Kit | null;
  companyBriefLocked: boolean;
  practice: PracticeState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKitInput {
  ownerId: string;
  jd: string;
  companyUrl: string;
  days: number;
}

export interface KitStore {
  create(input: CreateKitInput): Promise<StoredKit>;
  findById(id: string): Promise<StoredKit | null>;
  findByOwner(ownerId: string): Promise<StoredKit[]>;
  update(id: string, patch: Partial<Omit<StoredKit, "id" | "ownerId" | "createdAt">>): Promise<StoredKit | null>;
}
