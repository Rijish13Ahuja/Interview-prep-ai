import mongoose, { Schema, type Document, type Model } from "mongoose";
import type { CreateKitInput, KitStore, StoredKit, StoredUser, UserStore } from "./types.js";

interface UserDoc extends Document {
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const userSchema = new Schema<UserDoc>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
});

const UserModel: Model<UserDoc> = mongoose.models.User ?? mongoose.model<UserDoc>("User", userSchema);

interface KitDoc extends Document {
  ownerId: string;
  jd: string;
  companyUrl: string;
  days: number;
  status: string;
  step: string | null;
  error: { code: string; message: string } | null;
  // The generated content is validated by packages/core's KitSchema before every write —
  // stored as a flexible document here rather than re-declaring the entire Appendix A shape
  // a second time in Mongoose. Zod stays the single source of truth for structure.
  kit: unknown;
  companyBriefLocked: boolean;
  practice: { confidenceByCardId: Record<string, number>; coveredCardIds: string[] };
  createdAt: Date;
  updatedAt: Date;
}

const kitSchema = new Schema<KitDoc>({
  ownerId: { type: String, required: true, index: true },
  jd: { type: String, required: true },
  companyUrl: { type: String, required: true },
  days: { type: Number, required: true },
  status: { type: String, required: true, default: "pending" },
  step: { type: String, default: null },
  error: { type: Schema.Types.Mixed, default: null },
  kit: { type: Schema.Types.Mixed, default: null },
  companyBriefLocked: { type: Boolean, default: false },
  practice: {
    type: new Schema(
      { confidenceByCardId: { type: Schema.Types.Mixed, default: {} }, coveredCardIds: { type: [String], default: [] } },
      { _id: false }
    ),
    default: () => ({ confidenceByCardId: {}, coveredCardIds: [] }),
  },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

const KitModel: Model<KitDoc> = mongoose.models.Kit ?? mongoose.model<KitDoc>("Kit", kitSchema);

function toStoredUser(doc: UserDoc): StoredUser {
  return { id: doc.id, email: doc.email, passwordHash: doc.passwordHash, createdAt: doc.createdAt.toISOString() };
}

function toStoredKit(doc: KitDoc): StoredKit {
  return {
    id: doc.id,
    ownerId: doc.ownerId,
    jd: doc.jd,
    companyUrl: doc.companyUrl,
    days: doc.days,
    status: doc.status as StoredKit["status"],
    step: doc.step,
    error: doc.error,
    kit: doc.kit as StoredKit["kit"],
    companyBriefLocked: doc.companyBriefLocked,
    practice: doc.practice,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class MongoUserStore implements UserStore {
  async create(email: string, passwordHash: string): Promise<StoredUser> {
    const doc = await UserModel.create({ email, passwordHash });
    return toStoredUser(doc);
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    const doc = await UserModel.findOne({ email: email.toLowerCase() });
    return doc ? toStoredUser(doc) : null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await UserModel.findById(id);
    return doc ? toStoredUser(doc) : null;
  }
}

export class MongoKitStore implements KitStore {
  async create(input: CreateKitInput): Promise<StoredKit> {
    const doc = await KitModel.create({
      ownerId: input.ownerId,
      jd: input.jd,
      companyUrl: input.companyUrl,
      days: input.days,
    });
    return toStoredKit(doc);
  }

  async findById(id: string): Promise<StoredKit | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await KitModel.findById(id);
    return doc ? toStoredKit(doc) : null;
  }

  async findByOwner(ownerId: string): Promise<StoredKit[]> {
    const docs = await KitModel.find({ ownerId }).sort({ createdAt: -1 });
    return docs.map(toStoredKit);
  }

  async update(id: string, patch: Partial<Omit<StoredKit, "id" | "ownerId" | "createdAt">>): Promise<StoredKit | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await KitModel.findByIdAndUpdate(id, { ...patch, updatedAt: new Date() }, { new: true });
    return doc ? toStoredKit(doc) : null;
  }
}
