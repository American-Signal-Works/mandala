// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- Plate registry scaffold requires follow-up type narrowing for noUncheckedIndexedAccess.
// @ts-nocheck
import * as React from "react"

import type { TCaptionProps, TImageElement, TResizableProps } from "platejs"
import type { SlateElementProps } from "platejs/static"

import { NodeApi } from "platejs"
import { SlateElement } from "platejs/static"

import { cn } from "@workspace/ui/lib/utils"

export function ImageElementStatic(
  props: SlateElementProps<TImageElement & TCaptionProps & TResizableProps>
) {
  const { align = "center", caption, url, width } = props.element

  return (
    <SlateElement {...props} className="py-2.5">
      <figure className="group relative m-0 inline-block" style={{ width }}>
        <div
          className="relative max-w-full min-w-[92px]"
          style={{ textAlign: align }}
        >
          <div>
            <img
              className={cn(
                "w-full max-w-full cursor-default object-cover px-0",
                "rounded-sm"
              )}
              alt={
                (props.attributes as typeof props.attributes & { alt?: string })
                  .alt
              }
              src={url}
            />
          </div>
          {caption && (
            <figcaption
              className="mx-auto mt-2 h-[24px] max-w-full"
              style={{ textAlign: "center" }}
            >
              {NodeApi.string(caption[0])}
            </figcaption>
          )}
        </div>
      </figure>
      {props.children}
    </SlateElement>
  )
}
