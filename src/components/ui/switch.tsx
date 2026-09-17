"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * iOS-proportioned switch: 44×24 track, 18px thumb, 20px travel.
 *
 * The base mobile rule in index.css inflates bare buttons to 44px
 * min-height on touch devices — applied to this component's original
 * 32×18 track it produced a deformed 32×44 pill. This component is
 * deliberately exempt from that inflation: the visual track stays a
 * true switch, and the 44px touch floor is honored via an invisible
 * hit-area (the ::after extends the tappable region 10px past the
 * track on every side → 64×44 target).
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent p-0.5 shadow-xs transition-[color,background-color,border-color,box-shadow,transform] outline-none",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "after:absolute after:-inset-2.5 after:content-['']",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-[18px] rounded-full shadow-sm ring-0 transition-transform",
          "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
