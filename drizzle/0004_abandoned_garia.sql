ALTER TABLE "web_snapshot_chunks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "web_snapshot_chunks" CASCADE;--> statement-breakpoint
TRUNCATE TABLE "web_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "web_snapshots" DROP CONSTRAINT "web_snapshots_agent_id_agents_id_fk";
--> statement-breakpoint
DROP INDEX "web_snapshot_agent_resource_hash_uidx";--> statement-breakpoint
DROP INDEX "web_snapshots_agent_fetched_idx";--> statement-breakpoint
ALTER TABLE "web_snapshots" ALTER COLUMN "summary" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "web_snapshots" ADD COLUMN "raw_file_path" text NOT NULL;--> statement-breakpoint
ALTER TABLE "web_snapshots" ADD CONSTRAINT "web_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_snapshot_resource_hash_uidx" ON "web_snapshots" USING btree ("resource_id","content_hash");--> statement-breakpoint
CREATE INDEX "web_snapshots_fetched_idx" ON "web_snapshots" USING btree ("fetched_at");--> statement-breakpoint
ALTER TABLE "web_snapshots" DROP COLUMN "raw_text";
