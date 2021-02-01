export interface Logger {
  info(...message: any[]): void;
  error(...message: any[]): void;
  warn(...message: any[]): void;
}
