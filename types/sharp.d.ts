// Type stub for sharp — makes TypeScript happy when sharp is in optionalDependencies
// The actual types come from @types/sharp when sharp is installed locally
declare module "sharp" {
  interface Sharp {
    metadata(): Promise<Metadata>;
    stats(): Promise<Stats>;
    greyscale(): Sharp;
    normalise(): Sharp;
    linear(a?: number, b?: number): Sharp;
    sharpen(opts?: { sigma?: number; m1?: number; m2?: number }): Sharp;
    gamma(gamma?: number): Sharp;
    resize(width?: number | null, height?: number | null, opts?: object): Sharp;
    extract(region: { left: number; top: number; width: number; height: number }): Sharp;
    png(opts?: object): Sharp;
    jpeg(opts?: object): Sharp;
    toBuffer(): Promise<Buffer>;
  }
  interface Metadata {
    width?: number;
    height?: number;
    format?: string;
    channels?: number;
  }
  interface Stats {
    channels: Array<{ mean: number; stdev: number; min: number; max: number }>;
  }
  function sharp(input?: Buffer | string, opts?: object): Sharp;
  namespace sharp {
    const kernel: { lanczos3: string; nearest: string; cubic: string };
  }
  export = sharp;
}
