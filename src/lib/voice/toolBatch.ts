/**
 * One follow-up response per batch of tool calls (DESIGN §10.3). The agents SDK starts a response after
 * every tool output, so a turn with two `set_slot` calls got two spoken replies, the second re-asking
 * what the first had just asked. Every tool result goes back as a background result instead, and the
 * turn is continued once, when the whole batch of a response's tool calls has returned. No continue when
 * a tool is hanging up, or when the user spoke while the tools ran (server VAD answers that itself).
 */
interface Batch {
  announced: number;
  done: number;
  /** function calls the response carried, known at response.done */
  expected: number | null;
  hangUp: boolean;
  userSpoke: boolean;
}

export class ToolBatch {
  private batch: Batch = fresh();

  constructor(private readonly continueTurn: () => void) {}

  /** The batch a tool belongs to: read it when the tool starts, hand it back when it returns. */
  get current(): object {
    return this.batch;
  }

  /** A function_call item finished streaming (response.output_item.done). */
  announce() {
    // a closed batch still waiting on tools is superseded by the new response's calls
    if (this.batch.expected != null) this.batch = fresh();
    this.batch.announced += 1;
  }

  /** response.done: how many function calls that response carried. */
  close(expected: number) {
    if (expected === 0) return;
    this.batch.expected = expected;
    this.settle();
  }

  /** A tool returned. `token` is `current` as read when it started; a superseded batch's returns are ignored. */
  returned(token: object, opts: { hangUp?: boolean } = {}) {
    if (token !== this.batch) return;
    this.batch.done += 1;
    if (opts.hangUp) this.batch.hangUp = true;
    this.settle();
  }

  /** The user started talking while tools were running: their speech drives the next response. */
  userSpoke() {
    if (this.batch.announced > 0 || this.batch.done > 0) this.batch.userSpoke = true;
  }

  private settle() {
    const b = this.batch;
    if (b.expected == null || b.done < b.expected) return;
    this.batch = fresh();
    if (!b.hangUp && !b.userSpoke) this.continueTurn();
  }
}

const fresh = (): Batch => ({ announced: 0, done: 0, expected: null, hangUp: false, userSpoke: false });
