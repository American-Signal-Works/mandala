import { NextResponse, type NextRequest } from "next/server"
import { companiesResponseSchema } from "@workspace/control-plane"
import {
  ACTIVE_COMPANY_COOKIE,
  activeCompanyContextSchema,
  resolveActiveCompany,
  selectActiveCompany,
  selectActiveCompanySchema,
} from "@/lib/mandala/company-context"
import { listAccessibleCompanies } from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"

const cookieMaxAge = 60 * 60 * 24 * 365
const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "cookie, authorization",
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: privateHeaders }
    )

  try {
    const companies = companiesResponseSchema.parse({
      companies: await listAccessibleCompanies({
        supabase: auth.supabase,
        userId: auth.user.id,
      }),
    }).companies
    const storedCompanyId =
      auth.authMode === "cookie"
        ? request.cookies.get(ACTIVE_COMPANY_COOKIE)?.value
        : undefined
    const context = resolveActiveCompany(companies, storedCompanyId)
    const response = NextResponse.json(
      activeCompanyContextSchema.parse(context),
      {
        headers: privateHeaders,
      }
    )

    if (auth.authMode === "cookie") {
      if (context.status === "resolved") {
        setActiveCompanyCookie(
          response,
          context.activeCompany.id,
          request.nextUrl.protocol === "https:"
        )
      } else if (storedCompanyId) {
        clearActiveCompanyCookie(
          response,
          request.nextUrl.protocol === "https:"
        )
      }
    }

    return response
  } catch {
    return NextResponse.json(
      { error: "company_context_failed" },
      { status: 500, headers: privateHeaders }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: privateHeaders }
    )

  if (auth.authMode !== "cookie") {
    return NextResponse.json(
      { error: "cookie_auth_required" },
      { status: 400, headers: privateHeaders }
    )
  }

  const parsed = selectActiveCompanySchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateHeaders }
    )
  }

  try {
    const companies = companiesResponseSchema.parse({
      companies: await listAccessibleCompanies({
        supabase: auth.supabase,
        userId: auth.user.id,
      }),
    }).companies
    const context = selectActiveCompany(companies, parsed.data.companyId)
    if (!context) {
      return NextResponse.json(
        { error: "company_not_accessible" },
        { status: 404, headers: privateHeaders }
      )
    }

    const response = NextResponse.json(
      activeCompanyContextSchema.parse(context),
      {
        headers: privateHeaders,
      }
    )
    setActiveCompanyCookie(
      response,
      context.activeCompany.id,
      request.nextUrl.protocol === "https:"
    )
    return response
  } catch {
    return NextResponse.json(
      { error: "company_context_failed" },
      { status: 500, headers: privateHeaders }
    )
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function setActiveCompanyCookie(
  response: NextResponse,
  companyId: string,
  secure: boolean
) {
  response.cookies.set({
    name: ACTIVE_COMPANY_COOKIE,
    value: companyId,
    httpOnly: true,
    maxAge: cookieMaxAge,
    path: "/",
    sameSite: "lax",
    secure,
  })
}

function clearActiveCompanyCookie(response: NextResponse, secure: boolean) {
  response.cookies.set({
    name: ACTIVE_COMPANY_COOKIE,
    value: "",
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure,
  })
}
