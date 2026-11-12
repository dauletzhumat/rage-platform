'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md border border-border-strong bg-overlay px-2.5 py-1.5 text-xs text-foreground shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-overlay" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
