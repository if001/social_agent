import type { RuntimePersistence } from "./agent-runtime.js";
import type { PostProcessHarness } from "../infrastructure/agent/post-process-harness.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export class PostProcessService {
  constructor(private readonly persistence: RuntimePersistence, private readonly harness: PostProcessHarness, private readonly logger: Logger = noopLogger, private readonly retryBaseMs = 500) {}

  async processAgent(agentId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const job = await this.persistence.claimPostProcess(agentId);
      if (job === undefined) return;
      const logger = this.logger.child({ agentId, eventId: job.input.interactionInput.run.eventId, runId: job.input.interactionInput.run.runId, postProcessJobId: job.id });
      try {
        logger.log("info", "post_process.started", { attempt: job.attempt });
        const output = await this.harness.run(job.input, signal);
        await this.persistence.completePostProcess(job, output);
        logger.log("info", "post_process.completed", { persistentStateProposalCount: output.persistentStateUpdates.length, memoryProposalCount: output.memoryProposals.length, intentionProposalCount: output.intentionProposals.length, longTermCandidateCount: output.longTermCandidates.length });
      } catch (error) {
        await this.persistence.failPostProcess(job, error);
        logger.log("error", "post_process.failed", { ...errorLogContext(error), attempt: job.attempt });
        await delay(Math.min(30_000, this.retryBaseMs * 2 ** Math.min(job.attempt, 6)), signal);
      }
    }
  }

  async tick(signal: AbortSignal): Promise<number> {
    const job = await this.persistence.claimPostProcess();
    if (job === undefined) return 0;
    try {
      const output = await this.harness.run(job.input, signal);
      await this.persistence.completePostProcess(job, output);
    } catch (error) {
      await this.persistence.failPostProcess(job, error);
      throw error;
    }
    return 1;
  }
}
