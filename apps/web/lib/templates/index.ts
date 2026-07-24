import type { PageTemplate } from "./types"
import { performanceDashboard } from "./trading-performance-dashboard"
import { dailyJournal } from "./trading-daily-journal"
import { weeklyReview } from "./trading-weekly-review"

export const templates: PageTemplate[] = [
  performanceDashboard,
  dailyJournal,
  weeklyReview,
]
