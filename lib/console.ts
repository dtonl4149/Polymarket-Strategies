/**
 * Console Utilities - Terminal output helpers
 */

export class Colors {
  static readonly BLACK = "\u001b[30m";
  static readonly RED = "\u001b[91m";
  static readonly GREEN = "\u001b[92m";
  static readonly YELLOW = "\u001b[93m";
  static readonly BLUE = "\u001b[94m";
  static readonly MAGENTA = "\u001b[95m";
  static readonly CYAN = "\u001b[96m";
  static readonly WHITE = "\u001b[97m";
  static readonly BOLD = "\u001b[1m";
  static readonly DIM = "\u001b[2m";
  static readonly UNDERLINE = "\u001b[4m";
  static readonly RESET = "\u001b[0m";
  static readonly SUCCESS = Colors.GREEN;
  static readonly WARNING = Colors.YELLOW;
  static readonly ERROR = Colors.RED;
  static readonly INFO = Colors.BLUE;
  static readonly TRADE = Colors.MAGENTA;
}

const LOG_SYMBOLS: Record<string, [string, string]> = {
  info: ["\u2139", Colors.BLUE],
  success: ["\u2713", Colors.GREEN],
  warning: ["\u26a0", Colors.YELLOW],
  error: ["\u2717", Colors.RED],
  trade: ["$", Colors.MAGENTA],
  debug: ["\u00b7", Colors.DIM],
};

export function getTimestamp(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function formatLog(msg: string, level = "info", showTimestamp = true): string {
  const [symbol, color] = LOG_SYMBOLS[level] ?? LOG_SYMBOLS.debug!;
  const ts = getTimestamp();
  if (showTimestamp) return `${Colors.CYAN}[${ts}]${Colors.RESET} ${color}${symbol}${Colors.RESET} ${msg}`;
  return `${color}${symbol}${Colors.RESET} ${msg}`;
}

export function log(msg: string, level = "info", showTimestamp = true): string {
  const formatted = formatLog(msg, level, showTimestamp);
  console.log(formatted);
  return formatted;
}

export function clearScreen(): void {
  process.stdout.write("\u001b[2J\u001b[H");
}

export function moveCursorHome(): void {
  process.stdout.write("\u001b[H");
}

export function clearAndPrint(lines: string[]): void {
  process.stdout.write("\u001b[H\u001b[J" + lines.join("\n") + "\n");
}

export function formatPrice(price: number, width = 9): string {
  return price.toFixed(4).padStart(width, " ");
}

export function formatSize(size: number, width = 9): string {
  return size.toFixed(1).padStart(width, " ");
}

export function formatPnl(pnl: number, includeSign = true): string {
  const color = pnl >= 0 ? Colors.GREEN : Colors.RED;
  if (includeSign) return `${color}$${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}${Colors.RESET}`;
  return `${color}$${Math.abs(pnl).toFixed(2)}${Colors.RESET}`;
}

export function formatCountdown(minutes: number, seconds: number): string {
  if (minutes < 0) return "--:--";
  const totalSecs = minutes * 60 + seconds;
  if (totalSecs <= 0) return `${Colors.RED}ENDED${Colors.RESET}`;
  let color = Colors.GREEN;
  if (totalSecs <= 60) color = Colors.RED;
  else if (totalSecs <= 180) color = Colors.YELLOW;
  return `${color}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${Colors.RESET}`;
}

export class LogBuffer {
  maxSize: number;
  messages: string[] = [];

  constructor(maxSize = 5) {
    this.maxSize = maxSize;
  }

  add(msg: string, level = "info"): void {
    const formatted = formatLog(msg, level, true);
    this.messages.push(formatted);
    if (this.messages.length > this.maxSize) this.messages.shift();
  }

  getMessages(): string[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}

export class StatusDisplay {
  width: number;
  lines: string[] = [];

  constructor(width = 80) {
    this.width = width;
  }

  addLine(line: string): this {
    this.lines.push(line);
    return this;
  }

  addHeader(text: string): this {
    this.lines.push(`${Colors.BOLD}${text}${Colors.RESET}`);
    return this;
  }

  addSeparator(char = "-"): this {
    this.lines.push(char.repeat(this.width));
    return this;
  }

  addBoldSeparator(char = "="): this {
    this.lines.push(`${Colors.BOLD}${char.repeat(this.width)}${Colors.RESET}`);
    return this;
  }

  addBlank(): this {
    this.lines.push("");
    return this;
  }

  render(in_place = true): string {
    const output = this.lines.join("\n");
    if (in_place) process.stdout.write("\u001b[H\u001b[J" + output + "\n");
    else console.log(output);
    return output;
  }

  clear(): this {
    this.lines = [];
    return this;
  }

  getLines(): string[] {
    return [...this.lines];
  }
}
