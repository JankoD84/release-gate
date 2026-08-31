import { resetActivityLog } from "./activity-store.ts";
import { resetFinalDecisionStore } from "./final-decision-store.ts";

export function resetDemoState(): void {
  resetFinalDecisionStore();
  resetActivityLog();
}
