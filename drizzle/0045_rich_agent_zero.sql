CREATE TABLE "app"."conversation_messages" (
	"agent_id" text NOT NULL,
	"external_message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_agent_id_external_message_id_pk" PRIMARY KEY("agent_id","external_message_id"),
	CONSTRAINT "conversation_messages_direction_check" CHECK ("app"."conversation_messages"."direction" IN ('inbound','outbound'))
);
--> statement-breakpoint
CREATE TABLE "app"."conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_event_id" text,
	"last_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_status_check" CHECK ("app"."conversations"."status" IN ('active','completed','abandoned'))
);
--> statement-breakpoint
ALTER TABLE "app"."conversation_messages" ADD CONSTRAINT "conversation_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversation_messages" ADD CONSTRAINT "conversation_messages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_started_event_id_events_id_fk" FOREIGN KEY ("started_event_id") REFERENCES "app"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_last_event_id_events_id_fk" FOREIGN KEY ("last_event_id") REFERENCES "app"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_idx" ON "app"."conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_agent_status_idx" ON "app"."conversations" USING btree ("agent_id","status","updated_at");