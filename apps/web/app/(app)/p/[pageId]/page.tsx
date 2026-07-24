import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/pages/PageHeader"
import { PlateEditor } from "@/components/editor/PlateEditor"

const EMPTY_DOC = {
  type: "doc",
  children: [{ type: "p", children: [{ text: "" }] }],
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ pageId: string }>
}) {
  const { pageId } = await params
  const supabase = await createClient()
  const { data: page } = await supabase
    .from("pages")
    .select("id, title, emoji, page_type, document, updated_at")
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!page || page.page_type !== "dashboard") notFound()

  return (
    <div className="mx-auto max-w-3xl py-8">
      <PageHeader
        pageId={page.id}
        initialTitle={page.title}
        emoji={page.emoji}
      />
      <PlateEditor
        pageId={page.id}
        initialDocument={page.document ?? EMPTY_DOC}
        initialUpdatedAt={page.updated_at}
      />
    </div>
  )
}
