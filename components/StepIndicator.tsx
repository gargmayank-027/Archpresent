"use client";

interface Step {
  num: string;
  label: string;
  status: "pending" | "active" | "complete";
}

interface StepIndicatorProps {
  steps: Step[];
}

export function StepIndicator({ steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center">
      {steps.map((step, i) => (
        <div key={step.num} className="flex items-center">
          <div
            className={`flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase transition-colors ${
              step.status === "active"
                ? "text-stone-900"
                : step.status === "complete"
                ? "text-amber-600"
                : "text-stone-300"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] flex-shrink-0 ${
                step.status === "complete"
                  ? "border-amber-500 text-amber-600"
                  : step.status === "active"
                  ? "border-stone-900"
                  : "border-stone-200"
              }`}
            >
              {step.status === "complete" ? "✓" : step.num}
            </span>
            <span className="hidden sm:inline">{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className="w-8 h-px bg-stone-200 mx-2" />
          )}
        </div>
      ))}
    </div>
  );
}
