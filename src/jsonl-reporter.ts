import { createWriteStream, type WriteStream } from "node:fs";
import type { SkillsEvent } from "./types.js";

export interface JsonlReporterOptions {
  out?: (line: string) => void;
  file?: string;
}

export interface JsonlReporter {
  onEvent: (event: SkillsEvent) => void;
  close: () => Promise<void>;
}

export function jsonlReporter(options: JsonlReporterOptions = {}): JsonlReporter {
  let stream: WriteStream | undefined;
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (options.file) {
    stream = createWriteStream(options.file, { flags: "a" });
  }

  function write(line: string): void {
    if (stream) stream.write(`${line}\n`);
    else out(line);
  }

  return {
    onEvent(event) {
      write(JSON.stringify({ ts: new Date().toISOString(), ...event }));
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!stream) {
          resolve();
          return;
        }
        stream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
