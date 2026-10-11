import type { ContinuityInput, ContinuityOutput, MemoryExtractionInput, MemoryExtractionOutput, CandidateDetectionInput, CandidateDetectionOutput, ExperienceIntegrationOutput } from "../domain/contracts.js";

export interface ContinuityHarness { run(input: ContinuityInput, signal: AbortSignal): Promise<ContinuityOutput>; }
export interface MemoryExtractionHarness { run(input: MemoryExtractionInput, signal: AbortSignal): Promise<MemoryExtractionOutput>; }
export interface CandidateDetectorHarness { run(input: CandidateDetectionInput, signal: AbortSignal): Promise<CandidateDetectionOutput>; }
export interface ExperienceIntegrationHarness { run(input: ContinuityInput, signal: AbortSignal): Promise<ExperienceIntegrationOutput>; }
