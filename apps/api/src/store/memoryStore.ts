import { randomUUID } from "node:crypto";
import type { CreateKitInput, KitStore, StoredKit, StoredUser, UserStore } from "./types.js";

/** In-memory implementation used by tests — no external database required. */
export class InMemoryUserStore implements UserStore {
  private users = new Map<string, StoredUser>();

  async create(email: string, passwordHash: string): Promise<StoredUser> {
    const user: StoredUser = { id: randomUUID(), email, passwordHash, createdAt: new Date().toISOString() };
    this.users.set(user.id, user);
    return user;
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) return u;
    }
    return null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    return this.users.get(id) ?? null;
  }
}

export class InMemoryKitStore implements KitStore {
  private kits = new Map<string, StoredKit>();

  async create(input: CreateKitInput): Promise<StoredKit> {
    const now = new Date().toISOString();
    const kit: StoredKit = {
      id: randomUUID(),
      ownerId: input.ownerId,
      jd: input.jd,
      companyUrl: input.companyUrl,
      days: input.days,
      status: "pending",
      step: null,
      error: null,
      kit: null,
      companyBriefLocked: false,
      practice: { confidenceByCardId: {}, coveredCardIds: [] },
      createdAt: now,
      updatedAt: now,
    };
    this.kits.set(kit.id, kit);
    return kit;
  }

  async findById(id: string): Promise<StoredKit | null> {
    return this.kits.get(id) ?? null;
  }

  async findByOwner(ownerId: string): Promise<StoredKit[]> {
    return [...this.kits.values()].filter((k) => k.ownerId === ownerId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async update(id: string, patch: Partial<Omit<StoredKit, "id" | "ownerId" | "createdAt">>): Promise<StoredKit | null> {
    const existing = this.kits.get(id);
    if (!existing) return null;
    const updated: StoredKit = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.kits.set(id, updated);
    return updated;
  }
}
