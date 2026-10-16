// Identifiers and secrets: room ids (UUID, matched by the /ws route's
// pattern), peer ids (short, readable in logs) and rejoin tokens (128 bits
// from the platform CSPRNG, hex).
export class IdService {
  public roomId = (): string => crypto.randomUUID();

  public peerId = (): string => {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return `p_${this.hex(bytes)}`;
  };

  public token = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return this.hex(bytes);
  };

  private hex(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
  }
}

export default IdService;
