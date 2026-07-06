export default function getConfig(mode) {
  const criticalModel = process.env.REASONING_CRITICAL_MODEL || "o3";
  const nonCriticalModel = process.env.REASONING_NONCRITICAL_MODEL || "gpt-4o-mini";

  const normalizedMode = String(mode || "lite").toLowerCase();
  const isDeepMode = normalizedMode === "deep" || normalizedMode === "high";

  if (isDeepMode) {
    return {
      branches: 5,
      maxThoughts: 4,
      minLawRelevanceScore: 7,
      maxDiscoveredLaws: 12,
      models: {
        extractCase: nonCriticalModel,
        generateBranches: nonCriticalModel,
        runThoughtPlan: nonCriticalModel,
        runThoughtEval: criticalModel,
        aggregateResults: criticalModel
      }
    };
  }

  return {
    branches: 3,
    maxThoughts: 3,
    minLawRelevanceScore: 7,
    maxDiscoveredLaws: 10,
    models: {
      extractCase: nonCriticalModel,
      generateBranches: nonCriticalModel,
      runThoughtPlan: nonCriticalModel,
      runThoughtEval: criticalModel,
      aggregateResults: criticalModel
    }
  };
}
