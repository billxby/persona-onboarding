"use client";

import { Mail, MessageCircle, Phone, User, UserRoundPlus, Video } from "lucide-react";
import { motion } from "motion/react";
import { callController } from "@/lib/call/controller";
import { session, useSessionStore } from "@/lib/session/store";
import { PersonaAvatar } from "./Avatar";

/**
 * The contact card iOS shows when you tap the name in a thread's header or a shared contact
 * bubble: big photo (or the grey silhouette for a number that is not saved), name, the four
 * actions, then either the saved contact's details or "Create New Contact" / "Add to Existing".
 * Creating the contact is what puts Persona in Contacts here (which is what gates the App Clip
 * bubble on a real iPhone), so the two states of the simulator meet on this sheet.
 */
export function ContactSheet({ name, known, phone, onClose }: { name: string; known: boolean; phone: string; onClose: () => void }) {
  const inContacts = useSessionStore((s) => s.senderInContacts);
  const setSenderInContacts = useSessionStore((s) => s.setSenderInContacts);
  const saved = inContacts && known;

  const call = () => {
    const s = session.get();
    if (s.call.state === "ringing" || s.call.state === "connecting" || s.call.state === "live") return;
    s.logEvent("user.call_request", { via: "contact_sheet" });
    onClose();
    setTimeout(() => callController.ring(), 900 + Math.random() * 900);
  };
  const create = () => {
    session.get().logEvent("contact.create", { name });
    setSenderInContacts(true);
    onClose();
  };

  return (
    <motion.div
      data-contact-sheet
      initial={{ y: 844 }}
      animate={{ y: 0 }}
      exit={{ y: 844 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className="absolute inset-0 z-[29] flex flex-col bg-[#f2f2f7] text-screen-ink dark:bg-black"
    >
      {/* room for the system status bar */}
      <div className="h-[54px] shrink-0" />
      <div className="flex h-[44px] shrink-0 items-center justify-between px-4">
        <span />
        <button onClick={onClose} className="text-[17px] font-semibold text-imsg-blue active:opacity-60" aria-label="Done">
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <div className="flex flex-col items-center pt-2">
          {saved ? (
            <PersonaAvatar size={108} />
          ) : (
            <span className="flex h-[108px] w-[108px] items-center justify-center rounded-full bg-[#b8b8bd] text-white dark:bg-[#636366]" aria-hidden>
              <User className="h-[64px] w-[64px] translate-y-[6px]" strokeWidth={1.6} fill="currentColor" />
            </span>
          )}
          <div className="mt-3 text-[26px] font-semibold tracking-tight" data-contact-sheet-name>
            {saved || known ? name : phone}
          </div>
          {saved ? <div className="mt-0.5 text-[15px] text-screen-ink/55">Persona · your assistant</div> : known ? <div className="mt-0.5 text-[15px] text-screen-ink/55">{phone}</div> : null}
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2.5">
          <Action icon={MessageCircle} label="message" onClick={onClose} />
          <Action icon={Phone} label="call" onClick={call} testId="call" />
          <Action icon={Video} label="video" />
          <Action icon={Mail} label="mail" />
        </div>

        {saved ? (
          <div className="mt-5 space-y-3">
            <Group>
              <Row label="mobile" value={phone} accent />
            </Group>
            <Group>
              <Row label="company" value="Persona" />
              <Row label="notes" value="Your personal assistant, in Messages." />
            </Group>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <Group>
              <button onClick={create} className="flex w-full items-center gap-3 px-4 py-3 text-left text-[17px] text-imsg-blue active:bg-screen-ink/[0.04]" data-contact-create>
                <UserRoundPlus className="h-5 w-5" strokeWidth={2} /> Create New Contact
              </button>
              <div className="mx-4 h-px bg-screen-ink/[0.08]" />
              <button onClick={create} className="w-full px-4 py-3 text-left text-[17px] text-imsg-blue active:bg-screen-ink/[0.04]">
                Add to Existing Contact
              </button>
            </Group>
            <Group>
              <button className="w-full px-4 py-3 text-left text-[17px] text-imsg-blue">Share Contact</button>
            </Group>
            {!known && (
              <p className="px-2 text-center text-[13px] leading-snug text-screen-ink/45">
                This number isn&apos;t in your contacts. Persona picks a name for itself once you give it one.
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Action({ icon: Icon, label, onClick, testId }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; onClick?: () => void; testId?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      data-contact-action={testId ?? label}
      className="flex h-[58px] flex-col items-center justify-center gap-1 rounded-[12px] bg-white text-imsg-blue active:bg-white/70 disabled:text-imsg-blue/40 dark:bg-[#1c1c1e]"
    >
      <Icon className="h-5 w-5" strokeWidth={2} />
      <span className="text-[11px]">{label}</span>
    </button>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1c1c1e]">{children}</div>;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[13px] text-screen-ink/55">{label}</div>
      <div className={accent ? "text-[17px] text-imsg-blue" : "text-[17px]"}>{value}</div>
    </div>
  );
}
