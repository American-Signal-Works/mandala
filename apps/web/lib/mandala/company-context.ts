import { z } from "zod"
import {
  companyPermissionSchema,
  companySummarySchema,
  permissionsForCompanyRole,
  type CompanySummary,
} from "@workspace/control-plane"

export const ACTIVE_COMPANY_COOKIE = "mandala_active_company_id"

export const selectActiveCompanySchema = z
  .object({ companyId: z.string().uuid() })
  .strict()

export const activeCompanyContextSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("resolved"),
      activeCompany: companySummarySchema,
      companies: z.array(companySummarySchema).min(1),
      permissions: z.array(companyPermissionSchema),
    })
    .strict(),
  z
    .object({
      status: z.literal("company_selection_required"),
      activeCompany: z.null(),
      companies: z.array(companySummarySchema).min(2),
      permissions: z.array(companyPermissionSchema).max(0),
    })
    .strict(),
  z
    .object({
      status: z.literal("no_companies"),
      activeCompany: z.null(),
      companies: z.array(companySummarySchema).max(0),
      permissions: z.array(companyPermissionSchema).max(0),
    })
    .strict(),
])

export type ActiveCompanyContext = z.infer<typeof activeCompanyContextSchema>
type ResolvedActiveCompanyContext = Extract<
  ActiveCompanyContext,
  { status: "resolved" }
>

export function resolveActiveCompany(
  companies: CompanySummary[],
  storedCompanyId?: string
): ActiveCompanyContext {
  if (companies.length === 0) {
    return {
      status: "no_companies",
      activeCompany: null,
      companies,
      permissions: [],
    }
  }

  if (companies.length === 1) {
    return {
      status: "resolved",
      activeCompany: companies[0]!,
      companies,
      permissions: permissionsForCompanyRole(companies[0]!.role),
    }
  }

  const activeCompany = companies.find(
    (company) => company.id === storedCompanyId
  )
  if (activeCompany) {
    return {
      status: "resolved",
      activeCompany,
      companies,
      permissions: permissionsForCompanyRole(activeCompany.role),
    }
  }

  return {
    status: "company_selection_required",
    activeCompany: null,
    companies,
    permissions: [],
  }
}

export function selectActiveCompany(
  companies: CompanySummary[],
  companyId: string
): ResolvedActiveCompanyContext | null {
  const activeCompany = companies.find((company) => company.id === companyId)
  if (!activeCompany) return null

  return {
    status: "resolved",
    activeCompany,
    companies,
    permissions: permissionsForCompanyRole(activeCompany.role),
  }
}
