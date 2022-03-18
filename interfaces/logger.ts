export interface Logger {
  info(...message: any[]): void
  error(...message: any[]): void
  warn(...message: any[]): void
  debug(...message: any[]): void
  silly(...message: any[]): void
  object(...message: any[]): void // dump object as single line to console info
}
