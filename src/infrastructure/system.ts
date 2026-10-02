import { randomUUID } from "node:crypto";

import type { Clock, IdGenerator } from "../application/ports.js";

export class SystemClock implements Clock { now(): Date { return new Date(); } }
export class FixedClock implements Clock {
  constructor(private value: Date) {}
  now(): Date { return new Date(this.value); }
  set(value: Date): void { this.value = new Date(value); }
  advance(milliseconds: number): void { this.value = new Date(this.value.getTime() + milliseconds); }
}
export class UuidGenerator implements IdGenerator { next(): string { return randomUUID(); } }
export class SequenceIdGenerator implements IdGenerator {
  #index = 0;
  constructor(private readonly values: readonly string[]) {}
  next(): string {
    const value = this.values[this.#index++];
    if (value === undefined) throw new Error("ID sequence exhausted");
    return value;
  }
}
