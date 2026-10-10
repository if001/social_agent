ALTER TABLE "agent_states" ADD COLUMN "motives" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_states" ADD COLUMN "motive_exploration" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "drives";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "current_interests";--> statement-breakpoint
ALTER TABLE "agent_states" DROP COLUMN "interest_exploration";