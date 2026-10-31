ALTER TABLE "background_experiences" DROP COLUMN "age";
--> statement-breakpoint
ALTER TABLE "background_experiences" ADD COLUMN "phase" text DEFAULT '初期' NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_experiences" ALTER COLUMN "phase" DROP DEFAULT;
