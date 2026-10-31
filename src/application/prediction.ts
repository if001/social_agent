import type { AgentCoreInput, AgentRunResult, DomainEvent, PredictionContext, PredictionOutput, RecentExperience, RetrievedItem } from "../domain/contracts.js";

export type PredictionRecord = {
  readonly id: string;
  readonly agentId: string;
  readonly sourceEventId: string;
  readonly sourceRunId: string;
  readonly output: PredictionOutput;
  readonly createdAt: string;
};

export type PredictionModelInput = {
  readonly agentId: string;
  readonly observation: AgentCoreInput["observation"];
  readonly recentExperiences: readonly RecentExperience[];
  readonly previousPrediction?: { readonly id: string; readonly createdAt: string; readonly output: PredictionOutput };
  readonly memoryCandidates: readonly RetrievedItem[];
};

export interface PredictionRepository {
  save(record: PredictionRecord): Promise<void>;
  latest(agentId: string): Promise<PredictionRecord | undefined>;
  context(agentId: string): Promise<PredictionContext | undefined>;
}

export interface PredictionModel {
  predict(input: PredictionModelInput, signal: AbortSignal): Promise<PredictionOutput>;
}

export type PredictionServiceInput = {
  readonly event: DomainEvent;
  readonly input: AgentCoreInput;
  readonly result: AgentRunResult;
};

export interface PredictionService {
  afterResponse(input: PredictionServiceInput, signal: AbortSignal): Promise<void>;
}
