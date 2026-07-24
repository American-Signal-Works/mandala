import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Collection } from "@/lib/collections/collection"
import { CollectionListView } from "@/components/collection/CollectionListView"

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ pageId: string }>
}) {
  const { pageId } = await params
  const supabase = await createClient()
  const { data: page } = await supabase
    .from("pages")
    .select("id, title, emoji, page_type, collection_id")
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!page || page.page_type !== "collection" || !page.collection_id)
    notFound()

  const collection = await Collection.load(page.collection_id)
  const { data: views } = await supabase
    .from("collection_views")
    .select("*")
    .eq("collection_id", page.collection_id)
    .order("sort_index")
    .limit(1)
  const view = views?.[0]

  // SSR a fresh page of rows
  const initialRows = await collection.list({
    sort:
      (view?.config as { sort?: import("@/lib/collections/types").Sort[] })
        ?.sort ?? [],
    filters:
      (view?.config as { filters?: import("@/lib/collections/types").Filter[] })
        ?.filters ?? [],
    limit: 100,
  })

  return (
    <CollectionListView
      page={page as { id: string; title: string; emoji: string | null }}
      collection={{
        id: collection.id,
        name: collection.name,
        fields: collection.fields,
        managedByConnection: collection.managedByConnection,
        isSystem: collection.isSystem,
      }}
      view={
        view as {
          id: string
          config: {
            sort?: import("@/lib/collections/types").Sort[]
            filters?: import("@/lib/collections/types").Filter[]
            visibleFields?: string[]
          }
        }
      }
      initialRows={initialRows}
    />
  )
}
