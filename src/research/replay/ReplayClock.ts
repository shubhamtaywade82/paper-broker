export class ReplayClock {
  private currentTimestamp: number;
  private startTime: number;
  private endTime: number;

  constructor(startTime: number, endTime: number) {
    this.startTime = startTime;
    this.endTime = endTime;
    this.currentTimestamp = startTime;
  }

  getCurrentTimestamp(): number {
    return this.currentTimestamp;
  }

  advanceTo(newTimestamp: number): void {
    if (newTimestamp < this.currentTimestamp) {
      throw new Error(`Cannot advance ReplayClock backwards: current ${this.currentTimestamp}, target ${newTimestamp}`);
    }
    this.currentTimestamp = Math.min(newTimestamp, this.endTime);
  }

  isFinished(): boolean {
    return this.currentTimestamp >= this.endTime;
  }

  reset(): void {
    this.currentTimestamp = this.startTime;
  }
}
