ALTER TABLE "app"."conversation_messages" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."conversation_messages" ADD COLUMN "correlation_id" text;--> statement-breakpoint
CREATE INDEX "conversation_messages_correlation_idx" ON "app"."conversation_messages" USING btree ("agent_id","correlation_id","created_at");