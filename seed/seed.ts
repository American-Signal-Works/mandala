// seed/seed.ts
// Run with: pnpm seed
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SEED_SUPABASE_URL ?? "http://127.0.0.1:54321"
const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL ?? "seed@example.com"
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? "supersecure123"
const DEMO_COMPANY_ID =
  process.env.SEED_COMPANY_ID ?? "60000000-0000-4000-8000-000000000001"
const DEMO_COMPANY_NAME = process.env.SEED_COMPANY_NAME ?? "Mandala Bean Co."
const RESET = process.argv.includes("--reset")
const SEED_MANDALA_DEMO =
  process.env.SEED_MANDALA_DEMO === "true" ||
  (process.env.SEED_MANDALA_DEMO !== "false" && isLoopback(SUPABASE_URL))

async function main() {
  const serviceKey = await resolveServiceRoleKey()
  if (!serviceKey) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY not set. Source it from supabase status or apps/web/.env.local."
    )
    process.exit(1)
  }

  const admin = createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Find or create the seed user
  const {
    data: { users },
  } = await admin.auth.admin.listUsers()
  let user = users.find((u) => u.email === SEED_USER_EMAIL)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: SEED_USER_EMAIL,
      password: SEED_USER_PASSWORD,
      email_confirm: true,
    })
    if (error || !data.user) {
      console.error(`Failed to create seed user: ${error?.message}`)
      process.exit(1)
    }
    user = data.user
    console.log(`Created seed user: ${SEED_USER_EMAIL}`)
  } else {
    console.log(`Found existing seed user: ${SEED_USER_EMAIL}`)
  }

  if (SEED_MANDALA_DEMO) {
    await seedMandalaDemo(admin, user.id)
  }

  const parserBindingSecret = process.env.MANDALA_CONTROL_BINDING_SECRET?.trim()
  if (parserBindingSecret) {
    const { error } = await admin.rpc(
      "configure_workflow_control_parser_trust",
      { p_server_secret: parserBindingSecret }
    )
    if (error) {
      console.error(`Failed to configure parser trust: ${error.message}`)
      process.exit(1)
    }
    console.log("Configured conversational parser trust.")
  }

  if (RESET) {
    // Wipe seed user's IBKR-imported rows
    const { error: rowsErr } = await admin
      .from("collection_rows")
      .delete()
      .eq("owner_id", user.id)
      .like("source", "connection:ibkr-activity-statement%")
    if (rowsErr) console.warn(`Reset rows warning: ${rowsErr.message}`)

    const { error: importsErr } = await admin
      .from("connection_imports")
      .delete()
      .eq("owner_id", user.id)
    if (importsErr) console.warn(`Reset imports warning: ${importsErr.message}`)

    console.log("Reset complete (collection rows + import audit cleared).")
  }

  const csvPath = path.join(__dirname, "sample-activity-statement.csv")
  console.log("")
  console.log("=== Seed user ready ===")
  console.log(`  Email:    ${SEED_USER_EMAIL}`)
  console.log(`  Password: ${SEED_USER_PASSWORD}`)
  if (SEED_MANDALA_DEMO) {
    console.log(`  Company:  ${DEMO_COMPANY_NAME}`)
  }
  console.log("")
  console.log("For local CLI login, request a magic link for this email,")
  console.log("then open http://127.0.0.1:54324 to follow the message.")
  console.log("")
  console.log("For the IBKR sample import, choose:")
  console.log(`  ${csvPath}`)
  console.log("")
}

async function resolveServiceRoleKey(): Promise<string> {
  const configured = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (configured) return configured

  try {
    const { stdout } = await promisify(execFile)(
      process.platform === "win32" ? "supabase.exe" : "supabase",
      ["status", "-o", "json"],
      { encoding: "utf8" }
    )
    const status = JSON.parse(stdout) as { SERVICE_ROLE_KEY?: unknown }
    return typeof status.SERVICE_ROLE_KEY === "string"
      ? status.SERVICE_ROLE_KEY
      : ""
  } catch {
    return ""
  }
}

async function seedMandalaDemo(
  admin: ReturnType<typeof createClient>,
  userId: string
) {
  const { error: companyError } = await admin.from("companies").upsert(
    {
      id: DEMO_COMPANY_ID,
      name: DEMO_COMPANY_NAME,
      created_by: userId,
    },
    { onConflict: "id" }
  )
  if (companyError) {
    console.error(`Failed to seed demo company: ${companyError.message}`)
    process.exit(1)
  }

  const { error: membershipError } = await admin.rpc(
    "bootstrap_company_owner",
    {
      p_company_id: DEMO_COMPANY_ID,
      p_owner_user_id: userId,
    }
  )
  if (membershipError) {
    console.error(
      `Failed to seed demo company membership: ${membershipError.message}`
    )
    process.exit(1)
  }

  await seedSyntheticCommerceConnector(admin, userId)

  const { error: policyError } = await admin
    .from("company_approval_policies")
    .upsert(
      {
        company_id: DEMO_COMPANY_ID,
        workflow_type: "procurement_reorder",
        action_type: "execute_mock_purchase_order",
        minimum_role: "approver",
        require_human_approval: true,
        require_warning_acknowledgement: true,
      },
      { onConflict: "company_id,workflow_type,action_type" }
    )
  if (policyError) {
    console.error(`Failed to seed demo approval policy: ${policyError.message}`)
    process.exit(1)
  }

  console.log(`Seeded demo company: ${DEMO_COMPANY_NAME}`)
}

async function seedSyntheticCommerceConnector(
  admin: ReturnType<typeof createClient>,
  userId: string
) {
  const { data: connector, error: connectorError } = await admin
    .from("connector_definitions")
    .select("id")
    .eq("connector_key", "mandala.synthetic-commerce")
    .single()
  if (connectorError || !connector) {
    throw new Error(
      `Synthetic connector definition unavailable: ${connectorError?.message ?? "missing"}`
    )
  }

  const { data: connectorVersion, error: versionError } = await admin
    .from("connector_definition_versions")
    .select("id, schema_hash")
    .eq("connector_definition_id", connector.id)
    .eq("version", "1.0.0")
    .single()
  if (versionError || !connectorVersion) {
    throw new Error(
      `Synthetic connector version unavailable: ${versionError?.message ?? "missing"}`
    )
  }

  const { data: installation, error: installationError } = await admin
    .from("company_connector_installations")
    .upsert(
      {
        company_id: DEMO_COMPANY_ID,
        connector_definition_id: connector.id,
        connector_version_id: connectorVersion.id,
        display_name: "Mandala Bean Co. Synthetic Commerce",
        status: "connected",
        installed_by: userId,
      },
      { onConflict: "company_id,connector_definition_id" }
    )
    .select("id")
    .single()
  if (installationError || !installation) {
    throw new Error(
      `Failed to install synthetic connector: ${installationError?.message ?? "missing"}`
    )
  }

  const { data: offerings, error: offeringsError } = await admin
    .from("connector_capability_offerings")
    .select("capability_version_id")
    .eq("connector_version_id", connectorVersion.id)
  if (offeringsError || !offerings?.length) {
    throw new Error(
      `Synthetic connector capabilities unavailable: ${offeringsError?.message ?? "missing"}`
    )
  }

  const capabilityVersionIds = offerings.map(
    (offering) => offering.capability_version_id
  )
  const { data: capabilityVersions, error: capabilitiesError } = await admin
    .from("capability_definition_versions")
    .select("id, capability_definition_id")
    .in("id", capabilityVersionIds)
  if (capabilitiesError || !capabilityVersions) {
    throw new Error(
      `Synthetic capability versions unavailable: ${capabilitiesError?.message ?? "missing"}`
    )
  }
  const { data: capabilityDefinitions, error: definitionsError } = await admin
    .from("capability_definitions")
    .select("id, effect")
    .in(
      "id",
      capabilityVersions.map((version) => version.capability_definition_id)
    )
  if (definitionsError || !capabilityDefinitions) {
    throw new Error(
      `Synthetic capability metadata unavailable: ${definitionsError?.message ?? "missing"}`
    )
  }
  const effectByDefinition = new Map(
    capabilityDefinitions.map((definition) => [
      definition.id,
      definition.effect,
    ])
  )

  for (const version of capabilityVersions) {
    const effect = effectByDefinition.get(version.capability_definition_id)
    const { error: grantError } = await admin
      .from("company_connector_capability_grants")
      .upsert(
        {
          company_id: DEMO_COMPANY_ID,
          installation_id: installation.id,
          capability_version_id: version.id,
          status: "active",
          granted_by: userId,
          revoked_by: null,
          revoked_at: null,
        },
        { onConflict: "company_id,installation_id,capability_version_id" }
      )
    if (grantError)
      throw new Error(
        `Failed to grant synthetic capability: ${grantError.message}`
      )

    const { error: capabilityPolicyError } = await admin
      .from("company_capability_policies")
      .upsert(
        {
          company_id: DEMO_COMPANY_ID,
          capability_version_id: version.id,
          enabled: true,
          minimum_role: effect === "read" ? "member" : "approver",
          allow_model_processing: effect === "read",
          require_human_approval: effect !== "read",
          max_rows: 2_500,
          max_bytes: 1_048_576,
          updated_by: userId,
        },
        { onConflict: "company_id,capability_version_id" }
      )
    if (capabilityPolicyError) {
      throw new Error(
        `Failed to configure synthetic capability policy: ${capabilityPolicyError.message}`
      )
    }
  }

  const { error: healthError } = await admin
    .from("company_connector_health")
    .upsert(
      {
        company_id: DEMO_COMPANY_ID,
        installation_id: installation.id,
        status: "healthy",
        observed_schema_hash: connectorVersion.schema_hash,
        details: { source: "seed", credentialFree: true },
      },
      { onConflict: "installation_id,company_id" }
    )
  if (healthError) {
    throw new Error(
      `Failed to mark synthetic connector healthy: ${healthError.message}`
    )
  }
}

function isLoopback(value: string): boolean {
  try {
    const hostname = new URL(value).hostname
    return hostname === "127.0.0.1" || hostname === "localhost"
  } catch {
    return false
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
