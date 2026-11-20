import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Btn({ className, variant = "primary", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wide transition disabled:opacity-40",
        variant === "primary" && "bg-primary text-primary-foreground hover:brightness-110",
        variant === "ghost" && "border border-border bg-secondary text-secondary-foreground hover:border-primary",
        variant === "danger" && "border border-destructive/50 text-destructive hover:bg-destructive/10",
        className,
      )}
    />
  );
}

export function Field(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn("w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary", p.className)} />;
}

export function Area(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn("w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary", p.className)} />;
}

export function Panel({ title, children, right, className }: { title: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "bad" | "primary" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase",
        tone === "muted" && "border-border text-muted-foreground",
        tone === "ok" && "border-success/40 text-success",
        tone === "warn" && "border-accent/50 text-accent",
        tone === "bad" && "border-destructive/50 text-destructive",
        tone === "primary" && "border-primary bg-primary text-primary-foreground",
      )}
    >
      {children}
    </span>
  );
}
