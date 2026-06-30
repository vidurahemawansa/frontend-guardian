import { config } from "../config.js";
import { EventStore } from "./EventStore.js";
import { AnalysisStore } from "./AnalysisStore.js";

export { EventStore } from "./EventStore.js";
export { AnalysisStore } from "./AnalysisStore.js";

export const eventStore    = new EventStore(config.maxEvents);
export const analysisStore = new AnalysisStore(config.maxAnalyses);
