/**
 * OptionsMap — Immutable, case-insensitive key→value map for named command options.
 *
 * Extracted from controllers/options-parser.ts as a stateful single-purpose utility.
 * The parsing/validation helpers live in utils/options.util.ts — this file owns
 * only the runtime data structure so consumers can import the class without
 * pulling in parsing logic they don't need.
 */

// ── OptionDef ─────────────────────────────────────────────────────────────────

/**
 * Shape of each entry in a command's config.options array.
 * Mirrors the Discord SlashCommandOption fields that matter for cross-platform parity.
 */
export interface OptionDef {
  /** Name used as the key in key:value message parsing and options.get() lookups. */
  name: string;
  /** Human-readable description shown in usage/error messages and Discord's '/' menu. */
  description?: string;
  /** When true, the option must be present or the command is rejected with a usage error. */
  required?: boolean;
}

// ── OptionsMap ────────────────────────────────────────────────────────────────

/**
 * Immutable, case-insensitive key→value map for named command options.
 *
 * Constructed once per command dispatch and passed as `options` on the ctx object.
 * Command modules never construct this directly — `dispatchCommand` builds it.
 */
export class OptionsMap {
  readonly #data: Map<string, string>;

  constructor(data: Record<string, string> = {}) {
    // Normalise keys to lowercase at construction time so all get/has calls are
    // case-insensitive without repeating the toLowerCase at every lookup site.
    this.#data = new Map(
      Object.entries(data).map(([k, v]) => [k.toLowerCase(), v]),
    );
  }

  /**
   * Returns the value for the given option key (case-insensitive),
   * or undefined when the option was not provided by the user.
   */
  get(key: string): string | undefined {
    return this.#data.get(key.toLowerCase());
  }

  /** True when the option was present in the parsed input. */
  has(key: string): boolean {
    return this.#data.has(key.toLowerCase());
  }

  /** Exposes all resolved key→value pairs for introspection or iteration. */
  entries(): IterableIterator<[string, string]> {
    return this.#data.entries();
  }

  /**
   * Canonical empty OptionsMap for commands that define no options.
   * Returned as a singleton to avoid unnecessary allocations.
   */
  static empty(): OptionsMap {
    return new OptionsMap({});
  }
}
