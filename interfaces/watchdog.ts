export interface Watchdog {
  reset(): void;
  reset_subsystem(subsystem_name: string): void;
}
