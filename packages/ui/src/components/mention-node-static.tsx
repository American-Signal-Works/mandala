// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- Plate registry scaffold requires follow-up type narrowing for noUncheckedIndexedAccess.
// @ts-nocheck
import * as React from "react"

import type { TMentionElement } from "platejs"
import type { SlateElementProps } from "platejs/static"

import { KEYS } from "platejs"
import { SlateElement } from "platejs/static"

import { cn } from "@workspace/ui/lib/utils"
import { inlineSuggestionVariants } from "@workspace/ui/components/suggestion"

export function MentionElementStatic(
  props: SlateElementProps<TMentionElement> & {
    prefix?: string
  }
) {
  const { prefix } = props
  const element = props.element

  return (
    <SlateElement
      {...props}
      as="span"
      className={cn(
        "inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm font-medium",
        inlineSuggestionVariants(),
        element.children[0][KEYS.bold] === true && "font-bold",
        element.children[0][KEYS.italic] === true && "italic",
        element.children[0][KEYS.underline] === true && "underline"
      )}
      attributes={{
        ...props.attributes,
        "data-slate-value": element.value,
      }}
    >
      {props.children}
      {prefix}
      {element.value}
    </SlateElement>
  )
}
