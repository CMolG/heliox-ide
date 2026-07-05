export interface PipelineAssemblyStep {
  id: string;
  prompt: string;
  roleId: string;
  modIds: string[];
  prevStepIds: string[];
  /** Optional bounded loop-back to an earlier step: re-run the steps between `stepId` and this one, `maxIterations` total passes. */
  loopBackTo?: { stepId: string; maxIterations: number };
}

export interface PipelineAssembly {
  frameTitle: string;
  description: string;
  missingCapabilitiesRequested: string[];
  steps: PipelineAssemblyStep[];
}
