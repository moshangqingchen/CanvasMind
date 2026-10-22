export interface DesktopExitActivity {
  /** Includes activeVerifications, as returned by the lifecycle endpoint. */
  activeRuns?: number | null;
  activeVerifications?: number | null;
  activeWrites?: number | null;
}
export interface DesktopExitProgress extends Required<DesktopExitActivity> {
  phase: "saving" | "checking" | "waiting" | "closing";
  install: boolean;
  error?: string;
}
export function makeExitProgress(phase: DesktopExitProgress["phase"], install?: boolean, activity?: DesktopExitActivity): DesktopExitProgress;
export function exitActivityIsIdle(activity: unknown): boolean;
export function exitProgressPresentation(progress?: DesktopExitProgress | null): {
  label: string; title: string; message: string; details: string[]; canCancel: boolean;
};
export function exitWaitPresentation(activity: DesktopExitActivity, install?: boolean): { title: string; message: string; detail: string };
export function createExitProgressReporter(callbacks: { send(value: DesktopExitProgress): void; log(message: string): void | Promise<void> }): {
  progress(phase: DesktopExitProgress["phase"], install: boolean, activity: DesktopExitActivity | undefined, attempt: number): void;
  event(name: string): void | Promise<void>;
  error(message: string): void;
};
