import { createCanonicalSubjectResolver, userMainSubjectId } from "../../src/application/canonical-subject.js";
import { CurrentRelationshipDescriptionSchema, CurrentSelfStorySchema } from "../../src/domain/contracts.js";

describe("canonical user subject", () => {
  it("FR-82: maps only configured human owners to user-main", () => {
    const resolver = createCanonicalSubjectResolver(["discord-owner"]);
    expect(resolver.resolve({ id: "discord-owner", type: "human" })).toBe(userMainSubjectId);
    expect(resolver.resolve({ id: "other", type: "human" })).toBeUndefined();
    expect(resolver.resolve({ id: "bot", type: "agent" })).toBeUndefined();
    expect(resolver.resolve(undefined)).toBeUndefined();
    expect(resolver.actorIdsFor(userMainSubjectId)).toEqual(["discord-owner"]);
  });

  it("FR-6, FR-82: permits only compact current Self and Relationship state", () => {
    expect(CurrentSelfStorySchema.safeParse("あ".repeat(600)).success).toBe(true);
    expect(CurrentSelfStorySchema.safeParse("あ".repeat(601)).success).toBe(false);
    expect(CurrentRelationshipDescriptionSchema.safeParse("あ".repeat(400)).success).toBe(true);
    expect(CurrentRelationshipDescriptionSchema.safeParse("あ".repeat(401)).success).toBe(false);
  });
});
