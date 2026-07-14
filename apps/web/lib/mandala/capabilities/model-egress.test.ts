import { describe, expect, it } from "vitest"
import type { CompiledCapabilityBinding } from "../skills/compiler"
import { projectCapabilityDataForModel } from "./model-egress"

describe("capability model egress", () => {
  it("projects only platform-classified fields and drops canary secrets", () => {
    const binding: CompiledCapabilityBinding = {
      id: "commerce.catalog.read",
      alias: "products",
      version: "1.0.0",
      access: "read",
      connectorId: "mandala.synthetic-commerce",
      schemaDigest: "digest",
      toolName: "read_products",
      healthy: true,
      granted: true,
      useInPrompt: true,
      modelAllowedPaths: ["products[].sku", "products[].title"],
    }
    const result = projectCapabilityDataForModel({
      bindings: [binding],
      data: {
        products: {
          products: [
            {
              sku: "BEAN-1",
              title: "House beans",
              cost: 12.34,
              oauthToken: "CANARY-SECRET-DO-NOT-LEAK",
            },
          ],
          connectorSecret: "CANARY-SECRET-DO-NOT-LEAK",
        },
      },
    })

    expect(result).toEqual({
      products: { products: [{ sku: "BEAN-1", title: "House beans" }] },
    })
    expect(JSON.stringify(result)).not.toContain("CANARY")
    expect(JSON.stringify(result)).not.toContain("cost")
  })
})
