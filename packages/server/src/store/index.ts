import { EventStore }    from "./EventStore.js";
import { AnalysisStore } from "./AnalysisStore.js";

export { EventStore }    from "./EventStore.js";
export { AnalysisStore } from "./AnalysisStore.js";

// Stores are now DB-backed — no size limit needed in constructors
export const eventStore    = new EventStore();
export const analysisStore = new AnalysisStore();
