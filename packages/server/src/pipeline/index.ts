import { config }           from "../config.js";
import { eventStore, analysisStore } from "../store/index.js";
import { RuleEngine }       from "../engine/RuleEngine.js";
import { createAiProvider } from "../ai/index.js";
import { AnalysisPipeline } from "./AnalysisPipeline.js";

export { AnalysisPipeline } from "./AnalysisPipeline.js";
export type { HealthScoreCard, CategoryScore, CategoryKey, CategoryIssueGroup } from "../engine/HealthScore.js";

const ruleEngine  = new RuleEngine();
const aiProvider  = createAiProvider(config);

/** Application-wide singleton pipeline shared by all routes. */
export const pipeline = new AnalysisPipeline(
  eventStore,
  analysisStore,
  ruleEngine,
  aiProvider,
);
