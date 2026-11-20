import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const PeerSchema = z.object({
  agentId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  discordUserId: z.string().trim().min(1),
  channelId: z.string().trim().min(1)
}).strict();
export const AgentPeersSchema = z.object({
  version: z.literal(1),
  agentId: z.string().trim().min(1),
  peers: z.array(PeerSchema)
}).strict().superRefine((value, context) => {
  const fields: Array<readonly [keyof z.infer<typeof PeerSchema>, string]> = [
    ["agentId", "agentId"], ["displayName", "displayName"], ["discordUserId", "discordUserId"]
  ];
  for (const [field, label] of fields) {
    const seen = new Set<string>();
    for (const [index, peer] of value.peers.entries()) {
      const key = field === "displayName" ? peer[field].normalize("NFKC").toLocaleLowerCase("ja") : peer[field];
      if (seen.has(key)) context.addIssue({ code: "custom", path: ["peers", index, field], message: `duplicate ${label}` });
      seen.add(key);
    }
  }
  for (const [index, peer] of value.peers.entries()) if (peer.agentId === value.agentId) context.addIssue({ code: "custom", path: ["peers", index, "agentId"], message: "self peer is not allowed" });
});
export type AgentPeer = z.infer<typeof PeerSchema>;
export type AgentPeers = z.infer<typeof AgentPeersSchema>;

export async function loadAgentPeersFile(path: string, expectedAgentId: string): Promise<AgentPeers> {
  const value = AgentPeersSchema.parse(parse(await readFile(path, "utf8")));
  if (value.agentId !== expectedAgentId) throw new Error(`Peer configuration agentId does not match BOT_ID: ${value.agentId}`);
  return value;
}
