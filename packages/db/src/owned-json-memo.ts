/** JSON memoization for immutable, repository-owned rows only. Never pass a
 * caller-owned input or a public DTO: identity is the invalidation contract. */
export class OwnedJsonMemo {
  private readonly entries = new Map<string, {
    reference: WeakRef<object>;
    json: string;
    bytes: number;
  }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 1024,
    // Count two bytes per UTF-16 code unit, including on V8's one-byte strings.
    private readonly maxBytes = 192 * 1024 * 1024,
  ) {}

  stringify(slot: string, value: unknown): string | undefined {
    const previous = this.entries.get(slot);
    if (value !== null && typeof value === "object" && previous?.reference.deref() === value) {
      this.entries.delete(slot);
      this.entries.set(slot, previous);
      return previous.json;
    }
    if (previous) this.remove(slot);
    const json = JSON.stringify(value);
    if (json === undefined || value === null || typeof value !== "object") return json;
    const bytes = json.length * 2 + slot.length * 2;
    if (bytes > this.maxBytes || this.maxEntries < 1) return json;
    // A logical slot holds only its latest revision. Weak references never keep
    // discarded repository rows alive; bounded strings are evicted by LRU.
    for (const [key, entry] of this.entries) {
      if (!entry.reference.deref()) this.remove(key);
    }
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.entries.set(slot, { reference: new WeakRef(value), json, bytes });
    this.bytes += bytes;
    return json;
  }

  private remove(slot: string): void {
    const previous = this.entries.get(slot);
    if (!previous) return;
    this.bytes -= previous.bytes;
    this.entries.delete(slot);
  }
}
