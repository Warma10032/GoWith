"use client";

import { useEffect, useState } from "react";

/**
 * 带防抖的 useEffect。delay ms 后才执行 effect；中途依赖变化则重置计时器。
 * 用于搜索输入：用户连续打字时不会打爆后端。
 */
export function useDebouncedEffect(
  effect: () => void | Promise<void> | (() => void),
  deps: ReadonlyArray<unknown>,
  delay = 350,
): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const handle = setTimeout(() => setTick((value) => value + 1), delay);
    return () => clearTimeout(handle);
    // tick 是内部 re-trigger 信号；用户传入 deps 决定何时重启防抖窗口。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);

  useEffect(() => {
    const result = effect();
    // 不 await Promise；effect 内部的 loading / error 状态自行管理。
    return typeof result === "function" ? result : undefined;
    // 调用方通过 deps 闭包确保 effect 引用最新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
}
