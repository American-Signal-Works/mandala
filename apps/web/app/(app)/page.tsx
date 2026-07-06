import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: pages } = await supabase
    .from("pages")
    .select("id, page_type")
    .eq("owner_type", "user")
    .eq("owner_id", user!.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (pages && pages[0]) {
    const p = pages[0];
    redirect(p.page_type === "dashboard" ? `/p/${p.id}` : `/c/${p.id}`);
  }

  return (
    <div className="max-w-2xl mx-auto py-12">
      <Card>
        <CardHeader>
          <CardTitle>Welcome to Mandala</CardTitle>
          <CardDescription>
            Pages are how you organize your work. Use <strong>+ New page</strong> in the sidebar to create
            a dashboard or a collection.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Once you create a page, you&apos;ll land on it next time you sign in.
        </CardContent>
      </Card>
    </div>
  );
}
