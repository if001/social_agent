ALTER TABLE "memories" ADD COLUMN "perspective" text DEFAULT 'self' NOT NULL;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "purpose" text DEFAULT 'self-guidance' NOT NULL;
--> statement-breakpoint
UPDATE "memories" AS m SET "perspective" = 'user', "purpose" = 'user-context'
WHERE EXISTS (SELECT 1 FROM "memory_subjects" AS ms WHERE ms."memory_id" = m."id");
