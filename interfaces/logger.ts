// NB: made it mandatory to supply a tags object as the first arg,
//  err is a special tag for passing exceptions
export interface Logger {
  info(tags: Object, ...message: any[]): void
  error(tags: Object, ...message: any[]): void
  warn(tags: Object, ...message: any[]): void
  debug(tags: Object, ...message: any[]): void
  silly(tags: Object, ...message: any[]): void
  object(tags: Object, ...message: any[]): void // dump object as single line to console info
}
