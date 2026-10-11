DROP TABLE "social_contexts" CASCADE;--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "acquired_disposition";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "values";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "interests";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "preferences";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "roles";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "raison_detre";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "self_narrative";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "self_continuity";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "emotion";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "motives";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "motive_exploration";