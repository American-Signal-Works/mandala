export type CollectionRequirement = {
  name: string
  managed_by_connection: string
}

export type PageTemplate =
  | {
      id: string
      name: string
      description: string
      emoji?: string
      pageType: "dashboard"
      // Plate document with placeholder block IDs to be substituted on instantiate
      document: unknown
      requiresCollections: CollectionRequirement[]
    }
  | {
      id: string
      name: string
      description: string
      emoji?: string
      pageType: "collection"
      collection: {
        name: string
        fields: Array<{ name: string; type: string }>
      }
      requiresCollections?: never
    }
