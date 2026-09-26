import type { MessageRow, SessionRow } from "@/lib/shared/types";
import { db } from "./db";
import { env } from "./env";
import { insertMessage } from "./messages";

export const VOICEMAIL_TRANSCRIPT = "It's your Persona. Text me your name and one thing you want gone this week and I'll start.";
const VOICEMAIL_SECONDS = 12;
const TTS_WAIT_MS = 5_000;

async function synthesize(voice: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: VOICEMAIL_TRANSCRIPT,
      instructions: "Warm, unhurried, like leaving a short friendly voicemail.",
      response_format: "mp3",
    }),
    signal,
  });
  if (!r.ok) return null;
  return r.arrayBuffer();
}

/** Generate the voicemail audio and store it; resolves to a public URL or null. Never throws. */
async function renderVoicemailAudio(session_id: string, signal: AbortSignal): Promise<string | null> {
  try {
    let audio = await synthesize(env.REALTIME_VOICE, signal);
    if (!audio && env.REALTIME_VOICE !== "coral") audio = await synthesize("coral", signal);
    if (!audio) return null;
    const path = `${session_id}.mp3`;
    const { error } = await db().storage.from("voicemail").upload(path, Buffer.from(audio), { contentType: "audio/mpeg", upsert: true });
    if (error) return null;
    return db().storage.from("voicemail").getPublicUrl(path).data.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * The declined-call voicemail (DESIGN §7.2): an audio bubble with its transcription. Audio is best effort:
 * we wait up to 5 s for TTS, otherwise insert transcript-only and attach the audio later if it arrives.
 */
export async function insertVoicemail(session: SessionRow): Promise<MessageRow | null> {
  try {
    const controller = new AbortController();
    const audioPromise = renderVoicemailAudio(session.id, controller.signal);
    const audio_url = await Promise.race<string | null>([audioPromise, new Promise((r) => setTimeout(() => r(null), TTS_WAIT_MS))]);
    const row = await insertMessage({
      session_id: session.id,
      role: "assistant",
      kind: "voicemail",
      content: VOICEMAIL_TRANSCRIPT,
      payload: { duration_sec: VOICEMAIL_SECONDS, transcript: VOICEMAIL_TRANSCRIPT, ...(audio_url ? { audio_url } : {}) },
    });
    if (!audio_url) {
      // late audio: patch the row when it lands (subscribers on `messages` updates pick it up)
      void audioPromise.then(async (url) => {
        if (!url) return;
        await db().from("messages").update({ payload: { ...row.payload, audio_url: url } }).eq("id", row.id);
      });
    }
    return row;
  } catch (e) {
    console.error("[voicemail] failed", e);
    return null;
  }
}
