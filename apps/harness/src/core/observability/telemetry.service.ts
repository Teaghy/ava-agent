export interface TelemetryService {
  span<T>(
    name: string,
    attributes: Record<string, string | number>,
    fn: () => Promise<T>,
  ): Promise<T>;
  log(data: Record<string, unknown>, message: string): void;
}
