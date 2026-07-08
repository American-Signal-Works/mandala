import * as React from "react"

import type { TLinkElement } from "platejs"
import type { SlateElementProps } from "platejs/static"

import { getLinkAttributes } from "@platejs/link"
import { SlateElement } from "platejs/static"
import { cn } from "@workspace/ui/lib/utils"
import { inlineSuggestionVariants } from "@workspace/ui/components/suggestion"

export function LinkElementStatic(props: SlateElementProps<TLinkElement>) {
  return (
    <SlateElement
      {...props}
      as="a"
      className={cn(
        "font-medium text-link underline decoration-link underline-offset-4",
        inlineSuggestionVariants()
      )}
      attributes={{
        ...props.attributes,
        ...getLinkAttributes(props.editor, props.element),
      }}
    >
      {props.children}
    </SlateElement>
  )
}
