import { expect, it } from "vitest";
import { animateLayout } from "./layout-animation";

it("uses one frame chain, finishes once, and reduced motion commits immediately", () => {
  let callback: FrameRequestCallback | undefined, requests = 0, completed = 0;
  const frames: number[] = [];
  const animation = animateLayout({ duration: 300, now: 0, request: next => { callback = next; return ++requests; }, cancel: () => {}, frame: t => frames.push(t), complete: () => completed++ });
  callback!(100);
  expect(requests).toBe(2);
  expect(frames[0]).toBeGreaterThan(1 / 3);
  callback!(300);
  animation.finish();
  expect(frames.at(-1)).toBe(1);
  expect(completed).toBe(1);
  animateLayout({ duration: 0, now: 0, request: () => { throw new Error("reduced motion scheduled animation"); }, cancel: () => {}, frame: t => expect(t).toBe(1), complete: () => completed++ });
  expect(completed).toBe(2);
});

it("cancellation cannot publish a late frame or save", () => {
  let callback: FrameRequestCallback | undefined;
  const frames: number[] = [];
  const animation = animateLayout({ duration: 300, now: 0, request: next => { callback = next; return 1; }, cancel: () => {}, frame: t => frames.push(t), complete: () => { throw new Error("cancelled layout saved"); } });
  animation.cancel();
  callback!(300);
  expect(frames).toEqual([]);
});
