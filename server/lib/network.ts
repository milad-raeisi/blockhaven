import os from 'node:os';

/** IPv4 addresses of this machine's non-internal network interfaces. */
export function getLanAddresses(): string[] {
  const result: string[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (!entries) continue;
    // Skip common virtual adapters (Docker, VirtualBox, WSL bridges).
    if (/^(docker|br-|veth|vboxnet|vmnet|utun|awdl|llw)/i.test(name)) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) result.push(entry.address);
    }
  }
  return [...new Set(result)];
}

export function getLanUrls(port: number): string[] {
  return getLanAddresses().map((ip) => `http://${ip}:${port}`);
}
