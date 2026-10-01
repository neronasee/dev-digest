// Ambient declaration for picomatch 4 — the package ships no bundled TS types
// (contrary to the plan's assumption), and pulling @types/picomatch would add
// a dependency the plan forbids. Typed to exactly the surface the smart-diff
// classifier uses: compile one glob, get a boolean matcher.
declare module 'picomatch' {
  export interface PicomatchOptions {
    /** Match dotfiles (leading-dot segments) — default false. */
    dot?: boolean;
  }
  export type PicomatchMatcher = (str: string) => boolean;
  function picomatch(glob: string | readonly string[], options?: PicomatchOptions): PicomatchMatcher;
  export default picomatch;
}
