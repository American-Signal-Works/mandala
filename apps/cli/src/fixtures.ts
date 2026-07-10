export const registeredFixtureScenarios = [
  {
    id: "clean_reorder",
    description: "Creates a reviewable baseline recommendation.",
  },
  {
    id: "sales_spike_warning",
    description: "Creates a recommendation with a recent-spike warning.",
  },
  {
    id: "duplicate_open_order",
    description: "Exercises duplicate-action suppression.",
  },
  { id: "stale_inventory", description: "Exercises stale-source blocking." },
  {
    id: "no_action",
    description: "Exercises a valid event that needs no action.",
  },
  {
    id: "edit_reorder",
    description: "Creates a draft suitable for edit review.",
  },
  {
    id: "reject_reorder",
    description: "Creates a draft suitable for rejection review.",
  },
] as const
