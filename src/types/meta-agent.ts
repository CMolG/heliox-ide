export interface PipelineAssemblyStep {
  id: string;
  prompt: string;
  roleId: string;
  modIds: string[];
  prevStepIds: string[];
}

export interface PipelineAssembly {
  frameTitle: string;
  description: string;
  missingCapabilitiesRequested: string[];
  steps: PipelineAssemblyStep[];
}
