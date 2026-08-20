import { z } from "zod";

/**
 * Why a fetch produced no usable data. Categories, not prose, so that callers
 * can branch on them and the UI can pick its own wording per case.
 */
export const DataFailureReasonSchema = z.enum([
  /**
   * The caller supplied something this application could not use, such as a
   * malformed pool address. Distinct from `configuration-error`, which is the
   * operator's problem, and from `not-found`, which means the input was well
   * formed but matched nothing.
   */
  "invalid-input",
  /** A required credential or setting is absent or malformed. */
  "configuration-error",
  "network-error",
  "timeout",
  "rate-limited",
  /** The source answered, but the payload failed schema validation. */
  "invalid-response",
  /**
   * The source answered with well-formed data describing a moment too far in the
   * past to act on. Distinct from `invalid-response`: nothing is malformed, the
   * figures are simply no longer current enough to reason about.
   */
  "stale-data",
  "not-found",
  "unknown",
]);

export type DataFailureReason = z.infer<typeof DataFailureReasonSchema>;

/** A read-only array the compiler knows holds at least one element. */
type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/** The string-keyed field names of `T`. */
type FieldNameOf<T> = keyof T & string;

/**
 * The contract every data-fetching module returns.
 *
 * Modelled as a discriminated union so application code cannot reach for `data`
 * without first establishing that data exists — the alternative, a nullable
 * payload plus an error field, lets a caller guess. `partial` exists because a
 * subgraph answering with three of five metrics is common and still useful, but
 * the advisor must know which figures it is missing before interpreting them.
 *
 * This is a plain TypeScript type rather than a Zod schema: these values are
 * built by this application, never parsed from an external boundary, so runtime
 * validation would add a layer without adding a guarantee. Zod stays the source
 * of truth for the `data` it wraps.
 */
export type DataResult<T> =
  | {
      readonly status: "success";
      readonly data: T;
    }
  | {
      readonly status: "partial";
      readonly data: T;
      /**
       * Names of the fields the source could not supply, so a caller can decide
       * whether the gap matters for the question being asked.
       *
       * Typed as a non-empty tuple of `T`'s own keys: a `partial` with nothing
       * missing is a `success`, and a misspelled field name is a lie about which
       * data is absent. Both are rejected by the compiler rather than by a runtime
       * check, because these values are built in-process and a type that permits
       * the invalid shape would need guarding at every construction site.
       */
      readonly missingFields: NonEmptyReadonlyArray<FieldNameOf<T>>;
      /** Non-fatal caveats, e.g. that a figure is stale. May be empty. */
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "unavailable";
      readonly reason: DataFailureReason;
      /**
       * A short, already-sanitized explanation safe to show a user.
       *
       * Must never carry an API key, a URL containing one, a stack trace, an
       * environment value or a raw provider payload. Anything needed for
       * debugging is logged server-side instead.
       */
      readonly message: string;
    };
