import type { PendingPostProcess, PostProcessOutput, RuntimePersistence } from "./agent-runtime.js";
import type { CandidateDetectorHarness, ContinuityHarness, MemoryExtractionHarness } from "../infrastructure/agent/post-process-harness.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export class PostProcessService {
  constructor(private readonly persistence: RuntimePersistence, private readonly harnesses: { readonly continuity: ContinuityHarness; readonly memory: MemoryExtractionHarness; readonly candidate: CandidateDetectorHarness }, private readonly logger: Logger = noopLogger, private readonly retryBaseMs = 500) {}

  #run(job: PendingPostProcess, signal: AbortSignal): Promise<PostProcessOutput> {
    if (job.type === "continuity") return this.harnesses.continuity.run(job.input, signal);
    if (job.type === "memory") return this.harnesses.memory.run(job.input, signal);
    return this.harnesses.candidate.run(job.input, signal);
  }

  async #execute(job: PendingPostProcess, signal: AbortSignal): Promise<boolean> {
    const logger = this.logger.child({ agentId: job.agentId, eventId: job.input.run.eventId, runId: job.input.run.runId, postProcessJobId: job.id, postProcessType: job.type });
    try {
      logger.log("info", "post_process.started", { attempt: job.attempt });
      const output = await this.#run(job, signal);
      await this.persistence.completePostProcess(job, output);
      const proposalCount = "persistentStateUpdates" in output ? output.persistentStateUpdates.length + output.intentionProposals.length : "memoryProposals" in output ? output.memoryProposals.length : output.longTermCandidates.length;
      logger.log("info", "post_process.completed", { proposalCount });
      return true;
    } catch (error) {
      await this.persistence.failPostProcess(job, error);
      logger.log("error", "post_process.failed", { ...errorLogContext(error), attempt: job.attempt });
      return false;
    }
  }

  async #executeType(agentId: string, runId: string, type: PendingPostProcess["type"], signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const job = await this.persistence.claimPostProcess(agentId, runId, type);
      if (job === undefined) return;
      if (await this.#execute(job, signal)) return;
      if (job.attempt >= 2) return;
      await delay(Math.min(30_000, this.retryBaseMs * 2 ** job.attempt), signal);
    }
  }

  async processAgent(agentId: string, signal: AbortSignal): Promise<void> {
    const continuity = await this.persistence.claimPostProcess(agentId, undefined, "continuity");
    const memory = await this.persistence.claimPostProcess(agentId, continuity?.input.run.runId, "memory");
    if (continuity === undefined && memory === undefined) return;
    const runId = continuity?.input.run.runId ?? memory?.input.run.runId;
    if (runId === undefined) return;
    await Promise.all([
      continuity === undefined ? this.#executeType(agentId, runId, "continuity", signal) : this.#execute(continuity, signal).then(async (ok) => { if (!ok && continuity.attempt < 2) { await delay(this.retryBaseMs * 2 ** continuity.attempt, signal); await this.#executeType(agentId, runId, "continuity", signal); } }),
      memory === undefined ? this.#executeType(agentId, runId, "memory", signal) : this.#execute(memory, signal).then(async (ok) => { if (!ok && memory.attempt < 2) { await delay(this.retryBaseMs * 2 ** memory.attempt, signal); await this.#executeType(agentId, runId, "memory", signal); } })
    ]);
    await this.#executeType(agentId, runId, "candidate", signal);
  }

  async tick(signal: AbortSignal): Promise<number> {
    const job = await this.persistence.claimPostProcess();
    if (job === undefined) return 0;
    if (!await this.#execute(job, signal)) throw new Error(`${job.type} post-process failed`);
    return 1;
  }
}
