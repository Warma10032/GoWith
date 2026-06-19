"use client";

import { AlertTriangle, LoaderCircle, SearchX } from "lucide-react";

interface ListStateProps {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  isFiltered: boolean;
  onRetry: () => void;
  /**
   * 「全部加载完成且结果为空」时的描述。区分两种语境：
   * - isFiltered=true：搜索/筛选无结果
   * - isFiltered=false：库中本来就还没有数据
   */
  emptyHint?: { initial: string; filtered: string };
}

/**
 * 后台列表页通用三态：loading / error / empty。
 * 放在列表渲染区前/后均可，组件自身无定位样式。
 */
export function ListState({
  loading,
  error,
  isEmpty,
  isFiltered,
  onRetry,
  emptyHint,
}: ListStateProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-muted">
        <LoaderCircle size={16} className="animate-spin text-brand" />
        正在加载…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-[#f2c7bd] bg-[#fff7f4] px-4 py-3 text-sm text-[#9a341f]">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">加载失败</p>
          <p className="mt-1 leading-6">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-[#f2c7bd] bg-white px-2 py-1 text-[11px] font-semibold hover:border-[#d94f30]"
          >
            <LoaderCircle size={11} />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    const hint = isFiltered
      ? (emptyHint?.filtered ?? "没有匹配当前搜索或筛选的记录")
      : (emptyHint?.initial ?? "当前列表还没有任何记录");
    return (
      <div className="rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-muted">
        <div className="mx-auto grid size-10 place-items-center rounded-full bg-[#f7efe8] text-brand">
          <SearchX size={18} />
        </div>
        <p className="mt-3 font-semibold text-ink">
          {isFiltered ? "没有匹配的记录" : "列表为空"}
        </p>
        <p className="mt-1 text-xs leading-5">{hint}</p>
        {isFiltered ? (
          <p className="mt-2 text-xs text-muted">
            清空搜索或筛选条件再试一次。
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
