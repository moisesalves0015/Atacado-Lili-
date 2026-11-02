import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const defaultStyle: CSSProperties = {
  "--normal-bg": "var(--popover, #ffffff)",
  "--normal-text": "var(--popover-foreground, #17343a)",
  "--normal-border": "var(--border, #e4ebe8)",
} as CSSProperties;

const Toaster = ({ style, toastOptions, ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        ...toastOptions,
        style: {
          background: "#ffffff",
          color: "#17343a",
          border: "1px solid #e4ebe8",
          boxShadow: "0 14px 36px rgba(15, 50, 52, 0.14)",
          ...toastOptions?.style,
        },
      }}
      style={{
        ...defaultStyle,
        ...style,
      }}
      {...props}
    />
  );
};

export { Toaster };
