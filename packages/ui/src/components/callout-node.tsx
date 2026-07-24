"use client"

import * as React from "react"

import { useCalloutEmojiPicker } from "@platejs/callout/react"
import { useEmojiDropdownMenuState } from "@platejs/emoji/react"
import { PlateElement } from "platejs/react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { EmojiPicker, EmojiPopover } from "./emoji-toolbar-button"

export function CalloutElement({
  attributes,
  children,
  className,
  ...props
}: React.ComponentProps<typeof PlateElement>) {
  const backgroundColor =
    typeof props.element.backgroundColor === "string"
      ? props.element.backgroundColor
      : undefined
  const icon =
    typeof props.element.icon === "string" ? props.element.icon : "💡"

  const { emojiPickerState, isOpen, setIsOpen } = useEmojiDropdownMenuState({
    closeOnSelect: true,
  })

  const { emojiToolbarDropdownProps, props: calloutProps } =
    useCalloutEmojiPicker({
      isOpen,
      setIsOpen,
    })

  return (
    <PlateElement
      className={cn("my-1 flex rounded-sm bg-muted p-4 pl-3", className)}
      style={{
        backgroundColor,
      }}
      attributes={{
        ...attributes,
        "data-plate-open-context-menu": true,
      }}
      {...props}
    >
      <div className="flex w-full gap-2 rounded-md">
        <EmojiPopover
          {...emojiToolbarDropdownProps}
          control={
            <Button
              variant="ghost"
              className="size-6 p-1 text-[18px] select-none hover:bg-muted-foreground/15"
              style={{
                fontFamily:
                  '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
              }}
              contentEditable={false}
            >
              {icon}
            </Button>
          }
        >
          <EmojiPicker {...emojiPickerState} {...calloutProps} />
        </EmojiPopover>
        <div className="w-full">{children}</div>
      </div>
    </PlateElement>
  )
}
