import { Simulator } from "@/components/Simulator";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[1100px] flex-col gap-6 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Persona onboarding simulator</h1>
          <p className="text-[13px] text-black/55">
            Layer 1: iMessage + call wrappers. UI only. The brain and voice transport are mocks behind swappable interfaces.
          </p>
        </div>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-800">
          mock brain · mock voice
        </span>
      </header>
      <Simulator />
    </main>
  );
}
