import { Simulator } from "@/components/Simulator";
import { StageMenu } from "@/components/stage/StageMenu";

export default function Page() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#ececf1]">
      {/* focused backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,#ffffff_0%,#ececf1_45%,#dcdce3_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(25,130,252,0.10)_0%,rgba(25,130,252,0)_60%)]" />

      <div className="absolute inset-0 flex items-center justify-center">
        <Simulator />
      </div>

      <StageMenu />
    </main>
  );
}
