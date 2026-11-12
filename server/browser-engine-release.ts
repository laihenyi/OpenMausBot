// Digests read from the official GitHub release on 2026-11-10, except the versioned Windows vendor build. 0.37.0's
// daemon never became ready on this fork's macOS machine, which stalled every browser tool; the darwin-arm64 asset
// was downloaded, hashed, and driven through a real page load before this pin moved. The other targets' digests and
// sizes are the release's published asset metadata, not a native run on this machine. The Dockerfile keeps its own
// official Linux version.
export const AGENT_BROWSER_VERSION = "0.39.4";

export interface AgentBrowserReleaseAsset {
  /** `<platform>-<arch>`; Linux adds `-musl` on Alpine-style systems. */
  target: string;
  asset: string;
  sha256: string;
  bytes: number;
  /** A reviewed platform-specific vendor revision; other assets use the upstream version. */
  version?: string;
  /** Exact release URL for a reviewed vendor build, never a mutable latest URL. */
  url?: string;
}

const RELEASES = new Map<string, AgentBrowserReleaseAsset>([
  [
    "darwin-arm64",
    { target: "darwin-arm64", asset: "agent-browser-darwin-arm64", sha256: "0317ce35172905c775c25b393914bc259701a464877aab9753ec8896f6e38bf7", bytes: 15886176 },
  ],
  [
    "darwin-x64",
    { target: "darwin-x64", asset: "agent-browser-darwin-x64", sha256: "21522a8ec34063fa294b0c928ad03d3485f1821ebe22f9da2b47b89963f731af", bytes: 17544264 },
  ],
  [
    "linux-arm64",
    { target: "linux-arm64", asset: "agent-browser-linux-arm64", sha256: "922b60dbd9f5c8b5c0f39b453bfe8cbf61b83abd487344028a508e8c4dca7883", bytes: 15930832 },
  ],
  [
    "linux-musl-arm64",
    { target: "linux-musl-arm64", asset: "agent-browser-linux-musl-arm64", sha256: "a532c13bdf40c6b8755cc52c711f63fd022c9e7403fce7a16b8fe8487c88c595", bytes: 15746488 },
  ],
  [
    "linux-musl-x64",
    { target: "linux-musl-x64", asset: "agent-browser-linux-musl-x64", sha256: "34a8be7c062a99164fc02322f22ac5f42870206cc7b59bb40ef045958ad3705b", bytes: 18215072 },
  ],
  [
    "linux-x64",
    { target: "linux-x64", asset: "agent-browser-linux-x64", sha256: "aa82c8ee81a38b8ad9ba61af02ced6dcbbb8af36dd8b2b479384177f8aa077a6", bytes: 18407640 },
  ],
  [
    "win32-x64",
    {
      // Upstream 0.39.4 still lacks vercel-labs/agent-browser#1781's Windows cold-start fix, which closed after this
      // pin's 2026-10-26 release, and nothing on this machine can run a Windows build natively. Retain the
      // native-verified revision until its replacement is tested.
      target: "win32-x64", version: "0.36.0-omb.1",
      asset: "agent-browser-win32-x64-0.36.0-omb.1.exe",
      url: "https://github.com/milind-soni/OpenMausBot/releases/download/browser-engine-v0.36.0-omb.1/agent-browser-win32-x64-0.36.0-omb.1.exe",
      sha256: "33bee834f6a6072ec8688b0914726e0262874d758f69f27e8baf7eaac6b5ed15", bytes: 13806080,
    },
  ],
]);

export function agentBrowserReleaseUrl(asset: AgentBrowserReleaseAsset): string {
  return asset.url ?? `https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/${asset.asset}`;
}

export function agentBrowserReleaseVersion(asset: AgentBrowserReleaseAsset | null): string {
  return asset?.version ?? AGENT_BROWSER_VERSION;
}

/**
 * The Linux-family key for this platform, or null when Vercel publishes nothing usable.
 *
 * Android is not musl: Termux runs the platform's bionic loader, so neither
 * `linux-<arch>` (glibc) nor `linux-musl-<arch>` describes it. What actually works
 * there is the statically linked musl build, which carries its own libc and needs no
 * interpreter at all. Keying Android to `linux-musl-<arch>` therefore picks the one
 * asset that runs, instead of reporting a build that does exist as missing.
 */
function linuxFamilyKey(platform: NodeJS.Platform, arch: string, musl: boolean): string {
  if (platform === "android") return `linux-musl-${arch}`;
  if (platform === "linux" && musl) return `linux-musl-${arch}`;
  return `${platform}-${arch}`;
}

/** The asset for this machine, or null where Vercel publishes none. */
export function resolveAgentBrowserReleaseAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl = false,
): AgentBrowserReleaseAsset | null {
  return RELEASES.get(linuxFamilyKey(platform, arch, musl)) ?? null;
}

